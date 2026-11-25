/**
 * [F2.2] Job de importação de extratos — spec §7.1/§7.4
 * (FINANCEIRO_IMPLEMENTACAO.md:1186-1205, 1315-1328).
 *
 * Fluxo: `decode → parse → normaliza → infere método → dedupe → duplicatas →
 * possibleDuplicate → verificação de saldo → grava ImportRow[] →
 * READY / NEEDS_REVIEW / FAILED`.
 *
 * O runner (`runFinanceImport`) é puro em relação à fila: recebe o id do lote
 * e a empresa, e pode ser chamado direto (teste, reprocessamento manual).
 */
import { randomUUID } from 'node:crypto';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { env } from '../config/env';
import prisma from '../config/db';
import { logger } from '../utils/logger';
import { fromCents, toCents } from '../domain/finance/money';
import { decodeOfx } from '../domain/finance/parsers/ofx/decode';
import { parseOfx } from '../domain/finance/parsers/ofx/parse';
import {
  BalanceCheck,
  buildImportRows,
  computeBalanceCheck,
} from '../domain/finance/imports/process-batch';
import { decryptBuffer, parseFileKey } from '../domain/finance/storage/crypto';
import { createFinanceStorage } from '../domain/finance/storage/factory';
import { createThrottledErrorLogger, redisRetryStrategy } from './redis-resilience';

export const FINANCE_IMPORT_QUEUE = 'finance-import';
export const FINANCE_IMPORT_JOB = 'process-import';
/** Tempo máximo de espera do enfileiramento — Redis fora não pode segurar a request. */
const ENQUEUE_TIMEOUT_MS = 2_000;

export interface FinanceImportResult {
  batchId: string;
  status: string;
  totalRows: number;
  newRows: number;
  duplicateRows: number;
  balanceCheck: BalanceCheck;
}

/** `2026-11-18` (data sem fuso) a partir de um Date do Postgres. */
const toIsoDate = (date: Date): string => date.toISOString().slice(0, 10);

/**
 * Processa um lote: lê o arquivo cifrado, decifra, parseia e grava o staging.
 *
 * Lotes já `CONFIRMED`/`DISCARDED` são ignorados (idempotência).
 * Qualquer erro marca o lote como `FAILED` com a mensagem em `errorMessage`
 * e é repassado (o worker registra; o lote fica auditável).
 */
export async function runFinanceImport(
  batchId: string,
  companyId: string
): Promise<FinanceImportResult> {
  const batch = await prisma.importBatch.findFirst({ where: { id: batchId, companyId } });
  if (!batch) {
    throw new Error(`Lote de importação ${batchId} não encontrado para a empresa ${companyId}`);
  }

  if (batch.status === 'CONFIRMED' || batch.status === 'DISCARDED') {
    return {
      batchId: batch.id,
      status: batch.status,
      totalRows: batch.totalRows,
      newRows: batch.newRows,
      duplicateRows: batch.duplicateRows,
      balanceCheck: batch.balanceCheck,
    };
  }

  await prisma.importBatch.update({
    where: { id: batch.id },
    data: { status: 'PROCESSING', errorMessage: null },
  });

  try {
    if (!batch.bankAccountId) {
      throw new Error('Lote sem conta bancária associada');
    }
    if (!batch.storageKey) {
      throw new Error('Arquivo do lote indisponível (retenção já removeu o bruto)');
    }

    const storage = createFinanceStorage();
    const key = parseFileKey(env.financeFileKey);

    const encrypted = await storage.get(batch.storageKey);
    const plain = decryptBuffer(encrypted, key);

    const parsed = parseOfx(decodeOfx(plain));
    if (parsed.kind === 'CARD') {
      throw new Error('Arquivo de cartão de crédito não é suportado na Fase 2');
    }

    const [account, acquirers, existing] = await Promise.all([
      prisma.bankAccount.findUnique({ where: { id: batch.bankAccountId } }),
      prisma.acquirer.findMany({
        where: { companyId },
        select: { bankKeywords: true },
      }),
      prisma.bankTransaction.findMany({
        where: { bankAccountId: batch.bankAccountId },
        select: {
          dedupeKey: true,
          postedAt: true,
          amount: true,
          normalizedDescription: true,
        },
      }),
    ]);

    if (!account) {
      throw new Error('Conta bancária do lote não encontrada');
    }

    const acquirerKeywords = acquirers.flatMap((acquirer) => acquirer.bankKeywords);

    const { rows, warnings, rowsCents } = buildImportRows({
      txs: parsed.txs.map((tx) => ({
        posted: tx.posted,
        cents: tx.cents,
        description: tx.description,
        memo: tx.memo,
        fitid: tx.fitid,
        type: tx.type,
      })),
      acquirerKeywords,
      existing: existing.map((tx) => ({
        dedupeKey: tx.dedupeKey,
        postedAt: toIsoDate(tx.postedAt),
        cents: toCents(tx.amount),
        normalizedDescription: tx.normalizedDescription,
      })),
      invertSigns: batch.invertSigns,
    });

    // Saldo da conta até (periodStart − 1): saldo inicial (se anterior ao
    // período) + transações já lançadas antes do período.
    const periodStart = parsed.start ? new Date(`${parsed.start}T00:00:00.000Z`) : null;
    let baseCents = 0;
    if (periodStart) {
      if (account.initialBalanceDate < periodStart) {
        baseCents += toCents(account.initialBalance);
      }
      const prior = await prisma.bankTransaction.aggregate({
        where: { bankAccountId: account.id, postedAt: { lt: periodStart } },
        _sum: { amount: true },
      });
      baseCents += toCents(prior._sum.amount ?? 0);
    }

    const { computedEndCents, balanceCheck } = computeBalanceCheck({
      baseCents,
      rowsCents,
      statementEndCents: parsed.ledgerCents ?? null,
    });

    const batchWarnings = [...warnings];
    if (balanceCheck === 'MISMATCH') batchWarnings.push('BALANCE_MISMATCH');
    if (account.ofxAccountId && parsed.accountId && account.ofxAccountId !== parsed.accountId) {
      batchWarnings.push('ACCOUNT_ID_MISMATCH');
    }

    const duplicateRows = rows.filter((row) => row.isDuplicate).length;
    const newRows = rows.filter((row) => !row.isDuplicate).length;
    const status = balanceCheck === 'MISMATCH' || batchWarnings.length > 0 ? 'NEEDS_REVIEW' : 'READY';

    await prisma.$transaction(async (tx) => {
      await tx.importRow.deleteMany({ where: { batchId: batch.id } });
      if (rows.length > 0) {
        await tx.importRow.createMany({
          data: rows.map((row) => ({
            id: randomUUID(),
            batchId: batch.id,
            rowIndex: row.rowIndex,
            postedAt: new Date(`${row.postedAt}T00:00:00.000Z`),
            amount: fromCents(row.cents),
            description: row.description,
            memo: row.memo ?? null,
            externalId: row.externalId ?? null,
            dedupeKey: row.dedupeKey,
            normalizedDescription: row.normalizedDescription,
            inferredMethod: row.inferredMethod,
            isDuplicate: row.isDuplicate,
            possibleDuplicate: row.possibleDuplicate,
            isIgnored: false,
            warnings: row.warnings,
          })),
        });
      }

      await tx.importBatch.update({
        where: { id: batch.id },
        data: {
          status,
          parserId: 'ofx-v1',
          periodStart: periodStart,
          periodEnd: parsed.end ? new Date(`${parsed.end}T00:00:00.000Z`) : null,
          statementEndBalance: parsed.ledgerCents === undefined ? null : fromCents(parsed.ledgerCents),
          computedEndBalance: fromCents(computedEndCents),
          balanceCheck,
          totalRows: rows.length,
          newRows,
          duplicateRows,
          warnings: batchWarnings,
          errorMessage: null,
        },
      });
    });

    return {
      batchId: batch.id,
      status,
      totalRows: rows.length,
      newRows,
      duplicateRows,
      balanceCheck,
    };
  } catch (error: any) {
    const message = error?.message ?? 'Falha ao processar a importação';
    await prisma.importBatch
      .update({
        where: { id: batch.id },
        data: { status: 'FAILED', errorMessage: message },
      })
      .catch(() => undefined);
    logger.error(`[finance-import] lote ${batch.id} falhou: ${message}`);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Fila
// ---------------------------------------------------------------------------

let queuePromise: Promise<Queue> | null = null;
let queueConnection: IORedis | null = null;

/**
 * Conexão do produtor: sem offline queue e com retries finitos para que
 * `queue.add` falhe rápido quando o Redis está fora, em vez de segurar a
 * requisição HTTP pendurada.
 */
async function getQueue(): Promise<Queue> {
  if (!queuePromise) {
    queuePromise = (async () => {
      const connection = new IORedis(env.redisUrl, {
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
        connectTimeout: 2_000,
        retryStrategy: redisRetryStrategy,
      });
      connection.on('error', createThrottledErrorLogger('Redis (finance-import) erro'));
      queueConnection = connection;
      return new Queue(FINANCE_IMPORT_QUEUE, { connection });
    })();
  }
  return queuePromise;
}

/**
 * Enfileira o processamento do lote. Fila fora do ar não pode derrubar nem
 * segurar a requisição de upload — o chamador decide o que fazer com o erro.
 */
export async function enqueueFinanceImport(batchId: string, companyId: string): Promise<void> {
  const queue = await getQueue();

  const add = queue.add(
    FINANCE_IMPORT_JOB,
    { batchId, companyId },
    {
      jobId: `finance-import-${batchId}`,
      attempts: 1,
      removeOnComplete: 100,
      removeOnFail: 500,
    }
  );

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`timeout de ${ENQUEUE_TIMEOUT_MS}ms ao enfileirar importação`)),
      ENQUEUE_TIMEOUT_MS
    );
  });

  try {
    await Promise.race([add, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Fecha o produtor (usado no shutdown). */
export async function closeFinanceImportQueue(): Promise<void> {
  const queuePromiseLocal = queuePromise;
  queuePromise = null;
  if (queuePromiseLocal) {
    await queuePromiseLocal.then((queue) => queue.close()).catch(() => undefined);
  }
  if (queueConnection) {
    await queueConnection.quit().catch(() => undefined);
    queueConnection = null;
  }
}

/** Worker da fila de importação (iniciado em `src/server.ts`). */
export function startFinanceImportWorker(): { close: () => Promise<void> } {
  const connection = new IORedis(env.redisUrl, {
    maxRetriesPerRequest: null,
    retryStrategy: redisRetryStrategy,
  });
  connection.on('error', createThrottledErrorLogger('Redis (finance-import worker) erro'));

  const worker = new Worker(
    FINANCE_IMPORT_QUEUE,
    async (job) => {
      if (job.name !== FINANCE_IMPORT_JOB) return;
      const result = await runFinanceImport(job.data.batchId, job.data.companyId);
      logger.info(
        `[finance-import] lote=${result.batchId} status=${result.status} linhas=${result.totalRows}`
      );
    },
    { connection }
  );

  worker.on('error', createThrottledErrorLogger('Worker finance-import erro'));
  worker.on('failed', (job, err) =>
    logger.error(`[finance-import] job ${job?.id} falhou: ${err.message}`)
  );

  return {
    close: async () => {
      await worker.close().catch(() => undefined);
      await connection.quit().catch(() => undefined);
      await closeFinanceImportQueue();
    },
  };
}
