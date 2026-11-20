import prisma from '../config/db';
import { NotificationType } from '@prisma/client';
import { logger } from '../utils/logger';
import { notifyUsers } from '../api/v1/notifications/notifications.service';

/**
 * Aviso de "agendamento começando agora".
 *
 * Estratégia em duas camadas:
 * 1. Job BullMQ com `delay` (entrega ~1s do horário) — depende do Redis.
 * 2. Reconciliador de 60s que grava direto os agendamentos JÁ vencidos e
 *    reagenda os jobs perdidos — depende apenas do banco.
 *
 * Regra dura: nunca notificar antes do `startTime`.
 */

const RECONCILE_INTERVAL_MS = 60_000;
/** Janela dos agendamentos já vencidos que ainda vale avisar. */
const OVERDUE_WINDOW_MS = 90_000;
/** Horizonte de lookahead para reagendar jobs futuros. */
const UPCOMING_WINDOW_MS = 2 * 60 * 60 * 1000;

const ACTIVE_STATUSES = ['SCHEDULED', 'CONFIRMED'] as const;

export const appointmentStartMessage = (clientName: string, startTime: Date) => {
  const time = new Date(startTime).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  });
  return `Agendamento começando agora: ${clientName} às ${time}`;
};

export const appointmentStartDedupeKey = (appointmentId: string, startTime: Date) =>
  `APPOINTMENT_STARTING:${appointmentId}:${new Date(startTime).toISOString()}`;

/**
 * Destinatários do aviso: profissional do agendamento + Admin + Recepção.
 */
export const resolveAppointmentStartRecipients = async (
  staffUserId?: string | null
): Promise<string[]> => {
  const or: Array<Record<string, any>> = [{ role: { name: { in: ['Admin', 'Recepção'] } } }];
  if (staffUserId) or.push({ id: staffUserId });

  const users = await prisma.user.findMany({
    where: {
      isActive: true,
      OR: or,
    },
    select: { id: true },
  });

  return [...new Set(users.map((u) => u.id))];
};

interface SchedulableAppointment {
  id: string;
  startTime: Date;
  client: { name: string };
  staff: { userId: string };
}

/**
 * Agenda o aviso para o horário exato do agendamento.
 * Best-effort: falha de Redis não derruba quem chamou.
 */
export const scheduleAppointmentStart = async (
  appointment: SchedulableAppointment
): Promise<void> => {
  try {
    const delay = new Date(appointment.startTime).getTime() - Date.now();
    if (delay <= 0) return; // já começou — o reconciliador cuida

    // Import dinâmico: se o Redis estiver fora, o import falha isolado aqui.
    const { addAppointmentStartJob } = await import('./queue');

    // Destinatários NÃO são congelados aqui: o worker resolve o profissional
    // atual no banco no momento da entrega (reatribuição muda quem recebe).
    await addAppointmentStartJob(
      {
        appointmentId: appointment.id,
        message: appointmentStartMessage(appointment.client.name, appointment.startTime),
        link: `/appointments/${appointment.id}`,
        startTime: new Date(appointment.startTime).toISOString(),
      },
      delay
    );
  } catch (error: any) {
    logger.error('Fila indisponível para agendar aviso de horário:', error?.message);
  }
};

/**
 * Reconciliador: grava o aviso dos agendamentos JÁ vencidos (sem depender do
 * Redis) e garante que os futuros tenham job na fila.
 * Exportado para allow teste determinístico (script de verificação).
 */
export const runAppointmentStartReconcile = async (): Promise<void> => {
  try {
    const now = Date.now();

    // 1) Já vencidos (janela curta) → grava direto
    const overdue = await prisma.appointment.findMany({
      where: {
        status: { in: [...ACTIVE_STATUSES] },
        startTime: {
          gte: new Date(now - OVERDUE_WINDOW_MS),
          lte: new Date(now),
        },
      },
      include: { client: true, staff: true },
    });

    for (const appointment of overdue) {
      const userIds = await resolveAppointmentStartRecipients(appointment.staff.userId);
      if (userIds.length === 0) continue;

      await notifyUsers(userIds, {
        type: NotificationType.APPOINTMENT_STARTING,
        message: appointmentStartMessage(appointment.client.name, appointment.startTime),
        appointmentId: appointment.id,
        link: `/appointments/${appointment.id}`,
        dedupeKey: appointmentStartDedupeKey(appointment.id, appointment.startTime),
      });
    }

    // 2) Futuros → garante que o job exista na fila.
    //    Falha do Redis aqui NÃO pode abortar o passo 1 (gravar vencidos).
    try {
      const upcoming = await prisma.appointment.findMany({
        where: {
          status: { in: [...ACTIVE_STATUSES] },
          startTime: {
            gt: new Date(now),
            lte: new Date(now + UPCOMING_WINDOW_MS),
          },
        },
        include: { client: true, staff: true },
      });

      if (upcoming.length === 0) return;

      const { notificationQueue, appointmentStartJobId } = await import('./queue');

      for (const appointment of upcoming) {
        const jobId = appointmentStartJobId(appointment.id, appointment.startTime);
        const existing = await notificationQueue.getJob(jobId);
        if (existing) continue;

        await scheduleAppointmentStart({
          id: appointment.id,
          startTime: appointment.startTime,
          client: appointment.client,
          staff: appointment.staff,
        });
      }
    } catch (error: any) {
      logger.error('Reconciliador não conseguiu reagendar jobs futuros:', error?.message);
    }
  } catch (error: any) {
    // Redis fora do ar não pode derrubar o reconciliador
    logger.error('Reconciliador de agendamento falhou:', error?.message);
  }
};

/**
 * Reconciliador: a cada 60s grava o aviso dos agendamentos JÁ vencidos
 * (sem depender do Redis) e garante que os futuros tenham job na fila.
 */
export const startAppointmentStartReconciler = (): void => {
  setInterval(() => {
    void runAppointmentStartReconcile();
  }, RECONCILE_INTERVAL_MS);

  void runAppointmentStartReconcile();
};
