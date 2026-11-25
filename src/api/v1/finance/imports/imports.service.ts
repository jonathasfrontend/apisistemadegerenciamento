/**
 * [F2.2] Upload + consulta de lotes de importação — spec §7.1/§7.4
 * (FINANCEIRO_IMPLEMENTACAO.md:1207-1218, 1315-1328) e §9.2 (1761-1767).
 *
 * Regras que não podem quebrar:
 *  - `companyId` vem SEMPRE do `req.user` (recarregado do banco), nunca do body;
 *  - o arquivo é cifrado (AES-256-GCM) antes de ir para o storage e o caminho
 *    nunca usa o nome original (`finance/{companyId}/{batchId}.ofx`);
 *  - mesmo hash já CONFIRMADO ⇒ 200 com aviso `IMPORT_ALREADY_IMPORTED`
 *    (a menos que `force=true`);
 *  - rate limit por empresa (contagem no banco — o `express-rate-limit` é
 *    global por IP, não por empresa).
 */
import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import prisma from '../../../../config/db';
import { env } from '../../../../config/env';
import { AppError } from '../../../../middlewares/error.handler';
import { toApi } from '../../../../domain/finance/money';
import { encryptBuffer, parseFileKey } from '../../../../domain/finance/storage/crypto';
import {
  createFinanceStorage,
  StorageNotConfiguredError,
} from '../../../../domain/finance/storage/factory';
import type { FileStorage } from '../../../../domain/finance/storage/types';
import { enqueueFinanceImport } from '../../../../jobs/finance-import';
import { buildPagination, ListParams, orderBy } from '../shared';

export interface UploadedFile {
  originalname?: string;
  mimetype?: string;
  size: number;
  buffer: Buffer;
}

export interface UploadInput {
  file: UploadedFile;
  bankAccountId: string;
  kind: 'BANK_STATEMENT' | 'CREDIT_CARD_INVOICE';
  invertSigns: boolean;
  force: boolean;
}

export interface UploadResult {
  alreadyImported: boolean;
  batch: ReturnType<typeof serializeBatch>;
}

/** Formatos aceitos na F2 (PDF entra na F3). */
export type DetectedFormat = 'OFX' | 'PDF' | null;

/**
 * Detecta o formato pelo conteúdo (não só pela extensão):
 * PDF começa com `%PDF`; OFX contém `<OFX>` ou `OFXHEADER` nos primeiros 2 KB.
 */
export function detectImportFormat(buffer: Buffer): DetectedFormat {
  const head = buffer.subarray(0, 2048).toString('latin1');
  if (head.startsWith('%PDF-')) return 'PDF';
  if (/<OFX>/i.test(head) || /OFXHEADER/i.test(head)) return 'OFX';
  return null;
}

/** Nome original é só exibição: entra no banco, nunca no caminho do storage. */
const safeFileName = (name?: string): string => {
  const base = (name ?? 'extrato.ofx').split(/[\\/]/).pop() ?? 'extrato.ofx';
  return base.slice(0, 255) || 'extrato.ofx';
};

export const serializeBatch = (batch: Prisma.ImportBatchGetPayload<Record<string, never>>) => ({
  id: batch.id,
  status: batch.status,
  kind: batch.kind,
  format: batch.format,
  bankAccountId: batch.bankAccountId,
  fileName: batch.fileName,
  fileSize: batch.fileSize,
  fileHash: batch.fileHash,
  parserId: batch.parserId,
  invertSigns: batch.invertSigns,
  periodStart: batch.periodStart ? batch.periodStart.toISOString().slice(0, 10) : null,
  periodEnd: batch.periodEnd ? batch.periodEnd.toISOString().slice(0, 10) : null,
  statementEndBalance: batch.statementEndBalance ? toApi(batch.statementEndBalance) : null,
  computedEndBalance: batch.computedEndBalance ? toApi(batch.computedEndBalance) : null,
  balanceCheck: batch.balanceCheck,
  totalRows: batch.totalRows,
  newRows: batch.newRows,
  duplicateRows: batch.duplicateRows,
  warnings: (batch.warnings as string[] | null) ?? [],
  errorMessage: batch.errorMessage,
  createdAt: batch.createdAt.toISOString(),
  updatedAt: batch.updatedAt.toISOString(),
  confirmedAt: batch.confirmedAt ? batch.confirmedAt.toISOString() : null,
});

export const serializeRow = (row: Prisma.ImportRowGetPayload<Record<string, never>>) => ({
  id: row.id,
  rowIndex: row.rowIndex,
  postedAt: row.postedAt.toISOString().slice(0, 10),
  amount: toApi(row.amount),
  description: row.description,
  memo: row.memo,
  externalId: row.externalId,
  dedupeKey: row.dedupeKey,
  normalizedDescription: row.normalizedDescription,
  inferredMethod: row.inferredMethod,
  isDuplicate: row.isDuplicate,
  possibleDuplicate: row.possibleDuplicate,
  isIgnored: row.isIgnored,
  warnings: row.warnings,
});

export class ImportsService {
  /**
   * Recebe o arquivo, valida, cifra, grava no storage e cria o lote `UPLOADED`.
   * O processamento (parse/staging) fica na fila `finance-import`.
   */
  async upload(companyId: string, userId: string, input: UploadInput): Promise<UploadResult> {
    const file = input.file;

    if (!file || !file.buffer || file.buffer.length === 0) {
      throw new AppError('Arquivo é obrigatório', 400, 'IMPORT_FILE_REQUIRED');
    }

    const format = detectImportFormat(file.buffer);
    const maxBytes = Math.max(env.financeMaxOfxMb, env.financeMaxPdfMb) * 1024 * 1024;

    if (file.size > maxBytes) {
      throw new AppError(
        'Arquivo excede o tamanho máximo permitido',
        413,
        'IMPORT_TOO_LARGE'
      );
    }

    if (!format) {
      throw new AppError('Formato de arquivo não suportado', 415, 'IMPORT_UNSUPPORTED_FILE');
    }

    if (format === 'OFX') {
      if (file.size > env.financeMaxOfxMb * 1024 * 1024) {
        throw new AppError(
          'Arquivo OFX excede o tamanho máximo permitido',
          413,
          'IMPORT_TOO_LARGE'
        );
      }
    } else {
      if (file.size > env.financeMaxPdfMb * 1024 * 1024) {
        throw new AppError(
          'Arquivo PDF excede o tamanho máximo permitido',
          413,
          'IMPORT_TOO_LARGE'
        );
      }
      throw new AppError(
        'Parser de PDF disponível a partir da Fase 3',
        415,
        'IMPORT_UNSUPPORTED_FILE'
      );
    }

    if (input.kind === 'CREDIT_CARD_INVOICE') {
      throw new AppError(
        'Fatura de cartão disponível a partir da Fase 3',
        415,
        'IMPORT_UNSUPPORTED_FILE'
      );
    }

    let storage: FileStorage;
    let key: Buffer;
    try {
      storage = createFinanceStorage();
      key = parseFileKey(env.financeFileKey);
    } catch (error) {
      if (error instanceof StorageNotConfiguredError) {
        throw new AppError(
          'Armazenamento de arquivos financeiros não configurado',
          503,
          'IMPORT_STORAGE_NOT_CONFIGURED'
        );
      }
      throw new AppError(
        'Chave de criptografia de arquivos financeiros inválida',
        503,
        'IMPORT_STORAGE_NOT_CONFIGURED'
      );
    }

    // Rate limit por empresa (20/hora por padrão) — contagem no banco, porque
    // o limiter global do Express é por IP, não por empresa.
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentImports = await prisma.importBatch.count({
      where: { companyId, createdAt: { gte: oneHourAgo } },
    });
    if (recentImports >= env.financeImportRateLimitPerHour) {
      throw new AppError(
        'Limite de importações por hora atingido para esta empresa',
        429,
        'IMPORT_RATE_LIMITED'
      );
    }

    const fileHash = createHash('sha256').update(file.buffer).digest('hex');

    if (!input.force) {
      const previous = await prisma.importBatch.findFirst({
        where: { companyId, fileHash, status: 'CONFIRMED' },
        orderBy: { createdAt: 'desc' },
      });
      if (previous) {
        return { alreadyImported: true, batch: serializeBatch(previous) };
      }
    }

    const account = await prisma.bankAccount.findFirst({
      where: { id: input.bankAccountId, companyId },
    });
    if (!account) {
      throw new AppError('Conta bancária não encontrada', 404);
    }

    const batchId = randomUUID();
    const storageKey = `finance/${companyId}/${batchId}.ofx`;

    await storage.put(storageKey, encryptBuffer(file.buffer, key));

    const batch = await prisma.importBatch.create({
      data: {
        id: batchId,
        companyId,
        kind: 'BANK_STATEMENT',
        format: 'OFX',
        bankAccountId: account.id,
        fileName: safeFileName(file.originalname),
        fileSize: file.size,
        fileHash,
        storageKey,
        status: 'UPLOADED',
        invertSigns: input.invertSigns,
        uploadedById: userId,
      },
    });

    try {
      await enqueueFinanceImport(batch.id, companyId);
    } catch (error: any) {
      // Sem fila não há processamento: o lote não fica pendurado para sempre.
      await prisma.importBatch
        .update({
          where: { id: batch.id },
          data: {
            status: 'FAILED',
            errorMessage: 'Fila de processamento indisponível',
          },
        })
        .catch(() => undefined);
      await storage.delete(storageKey).catch(() => undefined);
      throw new AppError(
        'Fila de processamento indisponível',
        503,
        'IMPORT_QUEUE_UNAVAILABLE'
      );
    }

    return { alreadyImported: false, batch: serializeBatch(batch) };
  }

  /** Lista de lotes da empresa (paginado). */
  async list(
    companyId: string,
    params: ListParams,
    status?: Prisma.EnumImportStatusFilter
  ) {
    const where: Prisma.ImportBatchWhereInput = {
      companyId,
      ...(status ? { status } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.importBatch.findMany({
        where,
        orderBy: orderBy(params) as Prisma.ImportBatchOrderByWithRelationInput,
        skip: (params.page - 1) * params.limit,
        take: params.limit,
      }),
      prisma.importBatch.count({ where }),
    ]);

    return {
      items: items.map(serializeBatch),
      pagination: buildPagination(params.page, params.limit, total),
    };
  }

  /** Detalhe do lote (status, resumo, avisos, saldo). */
  async getById(companyId: string, id: string) {
    const batch = await prisma.importBatch.findFirst({ where: { id, companyId } });
    if (!batch) throw new AppError('Lote de importação não encontrado', 404);
    return serializeBatch(batch);
  }

  /** Linhas em staging (paginado — até 200 por página). */
  async getRows(
    companyId: string,
    batchId: string,
    params: { page: number; limit: number }
  ) {
    const batch = await prisma.importBatch.findFirst({
      where: { id: batchId, companyId },
      select: { id: true },
    });
    if (!batch) throw new AppError('Lote de importação não encontrado', 404);

    const where: Prisma.ImportRowWhereInput = { batchId: batch.id };
    const [items, total] = await Promise.all([
      prisma.importRow.findMany({
        where,
        orderBy: { rowIndex: 'asc' },
        skip: (params.page - 1) * params.limit,
        take: params.limit,
      }),
      prisma.importRow.count({ where }),
    ]);

    return {
      items: items.map(serializeRow),
      pagination: buildPagination(params.page, params.limit, total),
    };
  }
}

export const importsService = new ImportsService();
