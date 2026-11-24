/**
 * [F1.7] Job diário de alerta de vencimento — spec:1162.
 * Notifica in-app quando há despesas vencidas. Só roda se FinanceSettings.enableOverdueAlerts.
 * Dedupe por expense+dia (America/Sao_Paulo) evita spam na reexecução.
 */
import { NotificationType } from '@prisma/client';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { env } from '../config/env';
import prisma from '../config/db';
import { logger } from '../utils/logger';
import { notifyUsers } from '../api/v1/notifications/notifications.service';
import { dateKeyInSaoPaulo } from '../domain/finance/payables/status';
import { createThrottledErrorLogger, redisRetryStrategy } from './redis-resilience';

export const FINANCE_OVERDUE_QUEUE = 'finance-overdue';
export const FINANCE_OVERDUE_JOB = 'notify-overdue';

function startOfTodaySp(now: Date): Date {
  const key = dateKeyInSaoPaulo(now); // YYYY-MM-DD em SP
  // 00:00:00 em SP = 03:00:00Z (UTC-3, sem DST desde 2019).
  return new Date(`${key}T03:00:00.000Z`);
}

export async function runFinanceOverdue(
  now = new Date(),
  companyIds?: string[]
): Promise<{ notified: number }> {
  const dayKey = dateKeyInSaoPaulo(now);
  const todaySp = startOfTodaySp(now);

  const companies = await prisma.company.findMany({
    where: companyIds ? { id: { in: companyIds } } : undefined,
    select: { id: true },
  });
  let notified = 0;

  for (const company of companies) {
    const settings = await prisma.financeSettings.findUnique({ where: { companyId: company.id } });
    const enabled = settings?.enableOverdueAlerts ?? true;
    if (!enabled) continue;

    const overdue = await prisma.expense.findMany({
      where: {
        companyId: company.id,
        isPaid: false,
        canceledAt: null,
        dueDate: { lt: todaySp },
      },
      select: { id: true, description: true, amount: true, dueDate: true },
    });

    const recipients = await prisma.user.findMany({
      where: {
        companyId: company.id,
        isActive: true,
        role: {
          rolePermissions: {
            some: { permission: { name: { in: ['finance.dashboard', 'finance.payables.view'] } } },
          },
        },
      },
      select: { id: true },
    });
    const recipientIds = recipients.map((u) => u.id);
    if (recipientIds.length === 0) continue;

    for (const expense of overdue) {
      const dedupeKey = `expense-overdue:${expense.id}:${dayKey}`;
      const existing = await prisma.notification.findFirst({
        where: { companyId: company.id, dedupeKey },
        select: { id: true },
      });
      if (existing) continue;

      const created = await notifyUsers(recipientIds, {
        type: NotificationType.EXPENSE_OVERDUE,
        message: `Despesa vencida: ${expense.description} (vencimento ${dateKeyInSaoPaulo(expense.dueDate)})`,
        dedupeKey,
        link: '/financeiro/a-pagar',
      }, company.id);
      if (created > 0) notified += 1;
    }
  }

  return { notified };
}

export function startFinanceOverdueWorker(): { close: () => Promise<void> } {
  const connection = new IORedis(env.redisUrl, {
    maxRetriesPerRequest: null,
    retryStrategy: redisRetryStrategy,
  });
  connection.on('error', createThrottledErrorLogger('Redis (finance-overdue) erro'));

  const worker = new Worker(
    FINANCE_OVERDUE_QUEUE,
    async (job) => {
      if (job.name !== FINANCE_OVERDUE_JOB) return;
      const result = await runFinanceOverdue();
      logger.info(`[finance-overdue] notificadas=${result.notified}`);
    },
    { connection }
  );

  worker.on('error', createThrottledErrorLogger('Worker finance-overdue erro'));
  worker.on('failed', (job, err) => logger.error(`[finance-overdue] job ${job?.id} falhou:`, err.message));

  const queue = new Queue(FINANCE_OVERDUE_QUEUE, { connection });
  void queue
    .add(FINANCE_OVERDUE_JOB, {}, { repeat: { pattern: '0 8 * * *', tz: 'America/Sao_Paulo' }, jobId: 'finance-overdue-daily' })
    .catch((err) => logger.warn('[finance-overdue] agendamento falhou:', err?.message));

  return {
    close: async () => {
      await worker.close().catch(() => undefined);
      await queue.close().catch(() => undefined);
      await connection.quit().catch(() => undefined);
    },
  };
}