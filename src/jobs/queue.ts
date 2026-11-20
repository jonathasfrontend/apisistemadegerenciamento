import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { createThrottledErrorLogger, redisRetryStrategy } from './redis-resilience';

/** Tempo máximo de espera do enfileiramento — Redis fora não pode segurar a request. */
const ENQUEUE_TIMEOUT_MS = 2_000;

const connection = new IORedis(env.redisUrl, {
  // Producer (não worker): sem offline queue e com retries finitos para que
  // `queue.add` falhe rápido quando o Redis está fora, em vez de ficar
  // pendurado indefinidamente segurando a requisição HTTP.
  enableOfflineQueue: false,
  maxRetriesPerRequest: 1,
  connectTimeout: 2_000,
  retryStrategy: redisRetryStrategy,
});

// Sem listener, um erro do ioredis derruba o processo (evento 'error' não tratado).
// O log é throttled: reconexão não pode virar spam de log.
connection.on('error', createThrottledErrorLogger('Redis (fila) erro de conexão'));

// Queue definitions
export const notificationQueue = new Queue('notifications', { connection });
export const paymentQueue = new Queue('payments', { connection });
export const reportQueue = new Queue('reports', { connection });

// Job types
export interface NotificationJob {
  type: 'whatsapp' | 'email' | 'sms';
  recipient: string;
  message: string;
  appointmentId?: string;
}

export interface PaymentJob {
  paymentId: string;
  action: 'process' | 'refund';
}

export interface ReportJob {
  type: 'daily' | 'weekly' | 'monthly';
  startDate: string;
  endDate: string;
}

/**
 * Job que cria a notificação in-app "Agendamento começando agora".
 *
 * O destinatário NÃO é congelado no payload: o worker resolve o profissional
 * atual no banco (reatribuição de profissional muda quem recebe).
 */
export interface AppointmentStartJob {
  appointmentId: string;
  message: string;
  link: string;
  /** ISO do startTime — parte da chave de dedupe. */
  startTime: string;
}

/**
 * JobId determinístico: reexecutar o agendamento não duplica o job.
 * BullMQ não aceita `:` no jobId → separador `-`.
 */
export const appointmentStartJobId = (appointmentId: string, startTime: Date) =>
  `appointment-start-${appointmentId}-${startTime.getTime()}`;

/**
 * Enfileira o aviso de "começando agora" com atraso até o horário do agendamento.
 * Não enfileira se o horário já passou (o reconciliador trata esse caso).
 *
 * Best-effort: fila fora do ar não pode derrubar nem segurar a requisição.
 */
export const addAppointmentStartJob = async (
  data: AppointmentStartJob,
  delayMs: number
): Promise<void> => {
  if (delayMs <= 0) return;

  const add = notificationQueue.add('appointment-start', data, {
    delay: delayMs,
    jobId: appointmentStartJobId(data.appointmentId, new Date(data.startTime)),
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    removeOnComplete: 100,
    removeOnFail: 500,
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`timeout de ${ENQUEUE_TIMEOUT_MS}ms ao enfileirar aviso de horário`)),
      ENQUEUE_TIMEOUT_MS
    );
  });

  try {
    await Promise.race([add, timeout]);
  } catch (error: any) {
    logger.warn(`Aviso de horário não enfileirado (${data.appointmentId}):`, error?.message);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

// Add jobs to queue
export const addNotificationJob = async (data: NotificationJob, delay?: number) => {
  return await notificationQueue.add('send-notification', data, {
    delay,
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
  });
};

export const addPaymentJob = async (data: PaymentJob) => {
  return await paymentQueue.add('process-payment', data, {
    attempts: 5,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
  });
};

export const addReportJob = async (data: ReportJob) => {
  return await reportQueue.add('generate-report', data);
};

// Schedule reminder jobs
export const scheduleReminder = async (
  appointmentId: string,
  clientPhone: string,
  _clientName: string,
  appointmentDate: Date,
  hoursBefor: number
) => {
  const reminderTime = new Date(appointmentDate);
  reminderTime.setHours(reminderTime.getHours() - hoursBefor);

  const delay = reminderTime.getTime() - Date.now();

  if (delay > 0) {
    await addNotificationJob(
      {
        type: 'whatsapp',
        recipient: clientPhone,
        message: `Lembrete: Você tem agendamento em ${hoursBefor}h`,
        appointmentId,
      },
      delay
    );
  }
};

logger.info('Queue system initialized');
