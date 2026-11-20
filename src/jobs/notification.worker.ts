import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import { NotificationType } from '@prisma/client';
import { env } from '../config/env';
import prisma from '../config/db';
import { logger } from '../utils/logger';
import { notifyUsers } from '../api/v1/notifications/notifications.service';
import { appointmentStartDedupeKey, appointmentStartMessage, resolveAppointmentStartRecipients } from './appointment-start';
import { createThrottledErrorLogger, redisRetryStrategy } from './redis-resilience';
import type { AppointmentStartJob } from './queue';

const connection = new IORedis(env.redisUrl, {
  maxRetriesPerRequest: null,
  retryStrategy: redisRetryStrategy,
});

// Sem listener, um erro do ioredis derruba o processo (evento 'error' não tratado).
// Log throttled: reconexão não pode virar spam de log.
connection.on('error', createThrottledErrorLogger('Redis (worker) erro de conexão'));

const ACTIVE_STATUSES = ['SCHEDULED', 'CONFIRMED'];

/**
 * Worker de notificações.
 *
 * Processa APENAS jobs in-app `appointment-start` (aviso de horário).
 * Jobs legados `send-notification` (WhatsApp/e-mail) são ignorados:
 * WhatsApp, e-mail e SMS estão fora do escopo do sistema de notificações.
 */
export const notificationWorker = new Worker(
  'notifications',
  async (job) => {
    if (job.name !== 'appointment-start') {
      logger.warn(`Job ${job.id} (${job.name}) ignorado — canal externo desativado`);
      return;
    }

    const data = job.data as AppointmentStartJob;

    try {
      const appointment = await prisma.appointment.findUnique({
        where: { id: data.appointmentId },
        select: {
          status: true,
          startTime: true,
          client: { select: { name: true } },
          staff: { select: { userId: true } },
        },
      });

      // O job só vale se o agendamento continuar ativo E já tiver começado.
      if (
        !appointment ||
        !ACTIVE_STATUSES.includes(appointment.status) ||
        appointment.startTime.getTime() > Date.now()
      ) {
        logger.info(
          `Job ${job.id} descartado — agendamento ${data.appointmentId} não está ativo/ainda não começou`
        );
        return;
      }

      // Destinatários resolvidos AGORA, no banco: se o profissional foi
      // reatribuído, o novo recebe e o antigo não.
      const userIds = await resolveAppointmentStartRecipients(appointment.staff.userId);
      if (userIds.length === 0) {
        logger.info(`Job ${job.id} descartado — sem destinatários ativos`);
        return;
      }

      await notifyUsers(userIds, {
        type: NotificationType.APPOINTMENT_STARTING,
        message: appointmentStartMessage(appointment.client.name, appointment.startTime),
        appointmentId: data.appointmentId,
        link: `/appointments/${data.appointmentId}`,
        dedupeKey: appointmentStartDedupeKey(data.appointmentId, appointment.startTime),
      });

      logger.info(`Aviso de horário entregue: ${data.appointmentId}`);
    } catch (error: any) {
      logger.error(`Job de horário falhou: ${job.id}`, error?.message);
      throw error;
    }
  },
  { connection }
);

notificationWorker.on('completed', (job) => {
  logger.info(`Job ${job.id} completed`);
});

notificationWorker.on('failed', (job, err) => {
  logger.error(`Job ${job?.id} failed:`, err.message);
});

// Sem listener, um erro do worker derruba o processo quando o Redis cai.
// Log throttled: reconexão não pode virar spam de log.
notificationWorker.on('error', createThrottledErrorLogger('Worker de notificações erro'));

logger.info('Notification worker started');
