import { Prisma, ReconStatus } from '@prisma/client';
import prisma from '../../../../config/db';
import { AppError } from '../../../../middlewares/error.handler';
import { computeDedupeKeys } from '../../../../domain/finance/dedupe';
import { fromCents, toApi, toCents } from '../../../../domain/finance/money';
import { normalizeDescription } from '../../../../domain/finance/text';
import { buildPagination } from '../shared';

interface ListInput {
  page: number;
  limit: number;
  bankAccountId?: string;
  from?: string;
  to?: string;
  status?: ReconStatus;
  direction?: 'IN' | 'OUT';
  method?: string;
  search?: string;
  minAmount?: number;
  maxAmount?: number;
  categoryId?: string;
}

interface CreateInput {
  bankAccountId: string;
  postedAt: string;
  amount: number;
  description: string;
  memo?: string | null;
  inferredMethod?: string;
  categoryId?: string | null;
}

interface PatchInput {
  categoryId?: string | null;
  notes?: string | null;
  status?: 'IGNORED' | 'PENDING';
}

const parseMoneyFilter = (raw: string | number | undefined, label: string): number | undefined => {
  if (raw === undefined || raw === '') return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new AppError(`${label} inválido`, 400);
  return n;
};

const targetId = (r: {
  targetType: string;
  paymentId: string | null;
  cardReceivableId: string | null;
  expenseId: string | null;
  otherIncomeId: string | null;
  cashMovementId: string | null;
  pairTransactionId: string | null;
}): string | null =>
  r.paymentId ??
  r.cardReceivableId ??
  r.expenseId ??
  r.otherIncomeId ??
  r.cashMovementId ??
  r.pairTransactionId;

const serializeReconciliation = (r: any) => ({
  id: r.id,
  targetType: r.targetType,
  targetId: targetId(r),
  amount: toApi(r.amount),
  score: r.score,
  origin: r.origin,
  createdAt: r.createdAt,
});

const serializeTx = (tx: any, suggestions = 0) => {
  const amountCents = toCents(tx.amount);
  const reconciledCents = toCents(tx.reconciledAmount);
  const remainingCents = Math.max(Math.abs(amountCents) - reconciledCents, 0);
  return {
    id: tx.id,
    companyId: tx.companyId,
    bankAccountId: tx.bankAccountId,
    source: tx.source,
    dedupeKey: tx.dedupeKey,
    externalId: tx.externalId,
    postedAt: tx.postedAt,
    amount: toApi(tx.amount),
    description: tx.description,
    normalizedDescription: tx.normalizedDescription,
    memo: tx.memo,
    counterpartyName: tx.counterpartyName,
    inferredMethod: tx.inferredMethod,
    status: tx.status,
    reconciledAmount: toApi(tx.reconciledAmount),
    remaining: fromCents(remainingCents).toNumber(),
    suggestions,
    categoryId: tx.categoryId,
    notes: tx.notes,
    importBatchId: tx.importBatchId,
    createdAt: tx.createdAt,
    updatedAt: tx.updatedAt,
    ...(tx.reconciliations ? { reconciliations: tx.reconciliations.map(serializeReconciliation) } : {}),
  };
};

export class BankTransactionsService {
  async list(companyId: string, input: ListInput) {
    const minAmount = parseMoneyFilter(input.minAmount as unknown as string, 'minAmount');
    const maxAmount = parseMoneyFilter(input.maxAmount as unknown as string, 'maxAmount');

    const and: Prisma.BankTransactionWhereInput[] = [{ companyId }];
    if (input.bankAccountId) and.push({ bankAccountId: input.bankAccountId });
    if (input.status) and.push({ status: input.status });
    if (input.method) and.push({ inferredMethod: input.method as any });
    if (input.categoryId) and.push({ categoryId: input.categoryId });
    if (input.direction === 'IN') and.push({ amount: { gt: 0 } });
    if (input.direction === 'OUT') and.push({ amount: { lt: 0 } });
    if (input.from || input.to) {
      and.push({
        postedAt: {
          ...(input.from ? { gte: new Date(`${input.from}T00:00:00.000Z`) } : {}),
          ...(input.to ? { lte: new Date(`${input.to}T23:59:59.999Z`) } : {}),
        },
      });
    }
    if (minAmount !== undefined || maxAmount !== undefined) {
      and.push({
        amount: {
          ...(minAmount !== undefined ? { gte: minAmount } : {}),
          ...(maxAmount !== undefined ? { lte: maxAmount } : {}),
        },
      });
    }
    if (input.search) {
      and.push({ normalizedDescription: { contains: normalizeDescription(input.search) } });
    }

    const where: Prisma.BankTransactionWhereInput = { AND: and };
    const [items, total] = await Promise.all([
      prisma.bankTransaction.findMany({
        where,
        orderBy: [{ postedAt: 'desc' }, { createdAt: 'desc' }],
        skip: (input.page - 1) * input.limit,
        take: input.limit,
      }),
      prisma.bankTransaction.count({ where }),
    ]);

    // Totais do filtro: soma das entradas e saídas sobre o WHERE completo.
    const inAgg = await prisma.bankTransaction.aggregate({
      where: { AND: [...and, { amount: { gt: 0 } }] },
      _sum: { amount: true },
    });
    const outAgg = await prisma.bankTransaction.aggregate({
      where: { AND: [...and, { amount: { lt: 0 } }] },
      _sum: { amount: true },
    });

    const totalIn = inAgg._sum.amount ? Math.abs(toApi(inAgg._sum.amount)) : 0;
    const totalOut = outAgg._sum.amount ? Math.abs(toApi(outAgg._sum.amount)) : 0;

    return {
      items: items.map((tx) => serializeTx(tx, 0)),
      pagination: buildPagination(input.page, input.limit, total),
      totals: {
        totalIn,
        totalOut,
        // Derivado: evita um terceiro aggregate só para o líquido.
        net: toApi(fromCents(toCents(totalIn) - toCents(totalOut))),
      },
    };
  }

  async getById(companyId: string, id: string) {
    const tx = await prisma.bankTransaction.findFirst({
      where: { id, companyId },
      include: { reconciliations: { orderBy: { createdAt: 'asc' } } },
    });
    if (!tx) throw new AppError('Transação bancária não encontrada', 404, 'BANK_TRANSACTION_NOT_FOUND');
    return serializeTx(tx, 0);
  }

  async createManual(companyId: string, input: CreateInput) {
    const account = await prisma.bankAccount.findFirst({
      where: { id: input.bankAccountId, companyId },
      select: { id: true },
    });
    if (!account) throw new AppError('Conta bancária não encontrada', 404, 'BANK_ACCOUNT_NOT_FOUND');

    if (input.categoryId) {
      const category = await prisma.financialCategory.findFirst({
        where: { id: input.categoryId, companyId },
        select: { id: true },
      });
      if (!category) throw new AppError('Categoria não encontrada', 404, 'CATEGORY_NOT_FOUND');
    }

    const cents = toCents(input.amount);
    const postedAtIso = input.postedAt;
    const [dedupeKey] = computeDedupeKeys([
      { postedAt: postedAtIso, cents, description: input.description, externalId: null },
    ]);

    try {
      const created = await prisma.bankTransaction.create({
        data: {
          companyId,
          bankAccountId: input.bankAccountId,
          source: 'MANUAL',
          dedupeKey,
          postedAt: new Date(`${postedAtIso}T00:00:00.000Z`),
          amount: fromCents(cents),
          description: input.description,
          normalizedDescription: normalizeDescription(input.description),
          memo: input.memo ?? null,
          inferredMethod: (input.inferredMethod as any) ?? 'OTHER',
          status: 'PENDING',
          categoryId: input.categoryId ?? null,
        },
      });
      return serializeTx(created, 0);
    } catch (error: any) {
      if (error?.code === 'P2002') {
        throw new AppError('Transação duplicada para esta conta', 409, 'BANK_TRANSACTION_DUPLICATE');
      }
      throw error;
    }
  }

  async patch(companyId: string, id: string, input: PatchInput) {
    const tx = await prisma.bankTransaction.findFirst({
      where: { id, companyId },
      include: { _count: { select: { reconciliations: true } } },
    });
    if (!tx) throw new AppError('Transação bancária não encontrada', 404, 'BANK_TRANSACTION_NOT_FOUND');

    if (input.categoryId !== undefined && input.categoryId !== null) {
      const category = await prisma.financialCategory.findFirst({
        where: { id: input.categoryId, companyId },
        select: { id: true },
      });
      if (!category) throw new AppError('Categoria não encontrada', 404, 'CATEGORY_NOT_FOUND');
    }

    if (input.status !== undefined) {
      if (input.status === 'IGNORED') {
        if (tx._count.reconciliations > 0 || toCents(tx.reconciledAmount) > 0) {
          throw new AppError(
            'Transação conciliada não pode ser ignorada',
            409,
            'BANK_TRANSACTION_HAS_RECONCILIATIONS'
          );
        }
      } else if (input.status === 'PENDING') {
        // status sozinho não basta: registro legado pode estar IGNORED com
        // valor parcialmente conciliado e nenhuma linha em Reconciliation.
        if (
          tx.status === 'RECONCILED' ||
          tx.status === 'PARTIAL' ||
          toCents(tx.reconciledAmount) > 0 ||
          tx._count.reconciliations > 0
        ) {
          throw new AppError('Transação conciliada não pode voltar a pendente', 409, 'BANK_TRANSACTION_STATUS_INVALID');
        }
      }
    }

    // updateMany com companyId no WHERE fecha a janela TOCTOU entre o
    // findFirst acima e a escrita (conta excluída/movida de tenant).
    const result = await prisma.bankTransaction.updateMany({
      where: { id, companyId },
      data: {
        ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      },
    });
    if (result.count === 0) {
      throw new AppError('Transação bancária não encontrada', 404, 'BANK_TRANSACTION_NOT_FOUND');
    }
    return this.getById(companyId, id);
  }
}

export const bankTransactionsService = new BankTransactionsService();
