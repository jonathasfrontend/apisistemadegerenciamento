/**
 * [F1.7] Job diário de recorrência — spec:1161.
 * Gera ocorrências futuras (próximos 3 meses) para despesas recorrentes.
 * Idempotente: generateOccurrences usa skipDuplicates + @@unique([recurrenceParentId,dueDate]).
 */
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { env } from '../config/env';
import prisma from '../config/db';
import { logger } from '../utils/logger';
import { payablesService } from '../api/v1/finance/payables/payables.service';
import { createThrottledErrorLogger, redisRetryStrategy } from './redis-resilience';

export const FINANCE_RECURRING_QUEUE = 'finance-recurring';
export const FINANCE_RECURRING_JOB = 'generate-recurring';

/** Roda o gerador para todos os modelos recorrentes ativos. Idempotente. */
export async function runFinanceRecurring(
  now = new Date(),
  companyIds?: string[]
): Promise<{ created: number; failed: number }> {
  const parents = await prisma.expense.findMany({
    where: {
      recurrenceInterval: { not: null },
      recurrenceParentId: null,
      canceledAt: null,
      ...(companyIds ? { companyId: { in: companyIds } } : {}),
    },
    select: { id: true, companyId: true },
  });

  let created = 0;
  let failed = 0;
  for (const parent of parents) {
    try {
      created += await payablesService.generateOccurrences(parent.companyId, parent.id, now);
    } catch (error: any) {
      failed += 1;
      logger.warn(`[finance-recurring] pai ${parent.id} (company ${parent.companyId}) falhou:`, error?.message);
    }
  }
  return { created, failed };
}

export function startFinanceRecurringWorker(): { close: () => Promise<void> } {
  const connection = new IORedis(env.redisUrl, {
    maxRetriesPerRequest: null,
    retryStrategy: redisRetryStrategy,
  });
  connection.on('error', createThrottledErrorLogger('Redis (finance-recurring) erro'));

  const worker = new Worker(
    FINANCE_RECURRING_QUEUE,
    async (job) => {
      if (job.name !== FINANCE_RECURRING_JOB) return;
      const result = await runFinanceRecurring();
      logger.info(`[finance-recurring] criadas=${result.created} falhas=${result.failed}`);
    },
    { connection }
  );

  worker.on('error', createThrottledErrorLogger('Worker finance-recurring erro'));
  worker.on('failed', (job, err) => logger.error(`[finance-recurring] job ${job?.id} falhou:`, err.message));

  const queue = new Queue(FINANCE_RECURRING_QUEUE, { connection });
  void queue
    .add(FINANCE_RECURRING_JOB, {}, { repeat: { pattern: '0 3 * * *', tz: 'America/Sao_Paulo' }, jobId: 'finance-recurring-daily' })
    .catch((err) => logger.warn('[finance-recurring] agendamento falhou:', err?.message));

  return {
    close: async () => {
      await worker.close().catch(() => undefined);
      await queue.close().catch(() => undefined);
      await connection.quit().catch(() => undefined);
    },
  };
}