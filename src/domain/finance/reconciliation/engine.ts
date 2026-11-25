/**
 * [F2.5] Motor de conciliação — spec §7.6.4/7.6.5 e invariantes I3–I6.
 *
 * Toda escrita acontece em `$transaction`; `companyId` sempre vem do usuário
 * autenticado (nunca do body). Alvos são validados com `findFirst({id, companyId})`
 * antes de virarem FK — isolamento de tenant não depende do cliente.
 */
import { Prisma, ReconOrigin, ReconStatus, ReconTargetType } from '@prisma/client';
import prisma from '../../../config/db';
import { AppError } from '../../../middlewares/error.handler';
import { fromCents, toApi, toCents } from '../money';
import { loadCandidates } from './candidates';
import { scoreCandidate } from './scoring';
import { cardToleranceCents, findSubset } from './subset-sum';

export interface MatchConfig {
  windowDays: number;
  cardTolerancePct: number;
}

export const DEFAULT_MATCH_CONFIG: MatchConfig = {
  windowDays: 3,
  cardTolerancePct: 0.5,
};

export interface TargetInput {
  targetType: ReconTargetType;
  targetId: string;
  /** Valor em reais (API), convertido para centavos antes de gravar. */
  amount: number;
}

export interface ReconcileInput {
  targets: TargetInput[];
  origin?: ReconOrigin;
}

interface ResolvedTarget {
  input: TargetInput;
  cents: number;
  /** Valor total do alvo em centavos (para I5). */
  totalCents: number;
  alreadyCents: number;
  fkField: 'paymentId' | 'cardReceivableId' | 'expenseId' | 'otherIncomeId' | 'cashMovementId' | 'pairTransactionId';
}

const FK_BY_TYPE: Record<ReconTargetType, ResolvedTarget['fkField'] | null> = {
  PAYMENT: 'paymentId',
  CARD_RECEIVABLE: 'cardReceivableId',
  EXPENSE: 'expenseId',
  OTHER_INCOME: 'otherIncomeId',
  CASH_MOVEMENT: 'cashMovementId',
  CARD_INVOICE: null, // Fase 3 — não existe na F2
  TRANSFER: 'pairTransactionId',
};

/** Busca a transação sempre com companyId do usuário. */
async function ownedTx(companyId: string, id: string) {
  const tx = await prisma.bankTransaction.findFirst({
    where: { id, companyId },
    include: { reconciliations: true },
  });
  if (!tx) throw new AppError('Transação bancária não encontrada', 404, 'BANK_TRANSACTION_NOT_FOUND');
  return tx;
}

/** Resolve valor/posse de um alvo. `null` = não pertence à empresa (404). */
async function resolveTarget(
  companyId: string,
  t: TargetInput
): Promise<{ totalCents: number; alreadyCents: number } | null> {
  const field = FK_BY_TYPE[t.targetType];
  if (!field) return null;

  let row: { value: Prisma.Decimal | number; total: number } | null = null;
  switch (t.targetType) {
    case 'PAYMENT': {
      const p = await prisma.payment.findFirst({
        where: { id: t.targetId, companyId },
        select: { amount: true, reconciliations: { select: { amount: true } } },
      });
      if (p) row = { value: p.amount, total: p.reconciliations.reduce((a, r) => a + toCents(r.amount), 0) };
      break;
    }
    case 'CARD_RECEIVABLE': {
      const r = await prisma.cardReceivable.findFirst({
        where: { id: t.targetId, companyId },
        select: { netAmount: true, reconciliations: { select: { amount: true } } },
      });
      if (r) row = { value: r.netAmount, total: r.reconciliations.reduce((a, r) => a + toCents(r.amount), 0) };
      break;
    }
    case 'EXPENSE': {
      const e = await prisma.expense.findFirst({
        where: { id: t.targetId, companyId },
        select: { paidAmount: true, amount: true, reconciliations: { select: { amount: true } } },
      });
      if (e) {
        row = {
          value: e.paidAmount ?? e.amount,
          total: e.reconciliations.reduce((a, r) => a + toCents(r.amount), 0),
        };
      }
      break;
    }
    case 'OTHER_INCOME': {
      const i = await prisma.otherIncome.findFirst({
        where: { id: t.targetId, companyId },
        select: { amount: true, reconciliations: { select: { amount: true } } },
      });
      if (i) row = { value: i.amount, total: i.reconciliations.reduce((a, r) => a + toCents(r.amount), 0) };
      break;
    }
    case 'CASH_MOVEMENT': {
      const m = await prisma.cashMovement.findFirst({
        where: { id: t.targetId, companyId },
        select: { amount: true, reconciliations: { select: { amount: true } } },
      });
      if (m) row = { value: m.amount, total: m.reconciliations.reduce((a, r) => a + toCents(r.amount), 0) };
      break;
    }
    case 'TRANSFER': {
      const p = await prisma.bankTransaction.findFirst({
        where: { id: t.targetId, companyId },
        select: { amount: true, transferPairId: true, reconciliations: { select: { amount: true } } },
      });
      if (p) {
        row = {
          value: Math.abs(toCents(p.amount)),
          total: p.reconciliations.reduce((a, r) => a + toCents(r.amount), 0),
        };
      }
      break;
    }
    default:
      return null;
  }
  if (!row) return null;
  return { totalCents: toCents(row.value), alreadyCents: row.total };
}

/** Recalcula status I4 a partir da soma das reconciliações. */
function statusFor(absolute: number, sum: number, current: ReconStatus): ReconStatus {
  if (sum <= 0) return current === 'IGNORED' ? 'IGNORED' : 'PENDING';
  if (sum >= absolute) return 'RECONCILED';
  return 'PARTIAL';
}

/** I6: Payment de cartão só é conciliado quando todos os recebíveis estão. */
async function syncCardPayment(companyId: string, paymentId: string) {
  const [total, done] = await Promise.all([
    prisma.cardReceivable.count({ where: { companyId, paymentId } }),
    prisma.cardReceivable.count({ where: { companyId, paymentId, isReconciled: true } }),
  ]);
  await prisma.payment.updateMany({
    where: { id: paymentId, companyId },
    data: {
      isReconciled: total > 0 && total === done,
      reconciledAt: total > 0 && total === done ? new Date() : null,
    },
  });
}

/** Marca/desmarca flags do alvo conforme a soma das reconciliações (I5/I6). */
async function syncTargetFlag(
  companyId: string,
  type: ReconTargetType,
  targetId: string,
  totalCents: number
) {
  const field = FK_BY_TYPE[type];
  if (!field || field === 'pairTransactionId') return;
  const sum = await prisma.reconciliation.aggregate({
    where: { companyId, [field]: targetId },
    _sum: { amount: true },
  });
  const done = toCents(sum._sum.amount ?? 0) >= totalCents;
  const data = { isReconciled: done, reconciledAt: done ? new Date() : null };
  const where = { id: targetId, companyId };
  switch (type) {
    case 'PAYMENT':
      await prisma.payment.updateMany({ where, data });
      break;
    case 'CARD_RECEIVABLE': {
      await prisma.cardReceivable.updateMany({ where, data });
      const r = await prisma.cardReceivable.findFirst({ where, select: { paymentId: true } });
      if (r) await syncCardPayment(companyId, r.paymentId);
      break;
    }
    case 'EXPENSE':
      await prisma.expense.updateMany({ where, data });
      break;
    case 'OTHER_INCOME':
      await prisma.otherIncome.updateMany({ where, data });
      break;
    case 'CASH_MOVEMENT':
      await prisma.cashMovement.updateMany({ where, data });
      break;
    default:
      break;
  }
}

/** Serialização localidada: a API reusa o serializer do service via getById. */
async function reload(companyId: string, id: string) {
  const tx = await prisma.bankTransaction.findFirst({
    where: { id, companyId },
    include: { reconciliations: { orderBy: { createdAt: 'asc' } } },
  });
  if (!tx) throw new AppError('Transação bancária não encontrada', 404, 'BANK_TRANSACTION_NOT_FOUND');
  return tx;
}

export async function reconcile(
  companyId: string,
  userId: string,
  id: string,
  input: ReconcileInput
) {
  const current = await ownedTx(companyId, id);
  const absolute = Math.abs(toCents(current.amount));

  const resolved: ResolvedTarget[] = [];
  for (const t of input.targets) {
    const cents = toCents(t.amount);
    if (cents <= 0) throw new AppError('Valor do alvo deve ser positivo', 400, 'RECONCILE_AMOUNT_INVALID');
    const info = await resolveTarget(companyId, t);
    if (!info) throw new AppError('Alvo não encontrado', 404, 'RECONCILE_TARGET_NOT_FOUND');
    resolved.push({
      input: t,
      cents,
      totalCents: info.totalCents,
      alreadyCents: info.alreadyCents,
      fkField: FK_BY_TYPE[t.targetType]!,
    });
  }

  const requested = resolved.reduce((a, r) => a + r.cents, 0);
  const already = current.reconciliations.reduce((a, r) => a + toCents(r.amount), 0);
  if (already + requested > absolute) {
    throw new AppError('Valor conciliado excede o valor da transação', 422, 'RECONCILE_AMOUNT_EXCEEDS');
  }
  // I5: cada alvo também tem teto próprio.
  for (const r of resolved) {
    if (r.alreadyCents + r.cents > r.totalCents) {
      throw new AppError('Valor conciliado excede o valor do alvo', 422, 'RECONCILE_AMOUNT_EXCEEDS');
    }
  }

  const origin = input.origin ?? 'MANUAL';
  await prisma.$transaction(async (tx) => {
    for (const r of resolved) {
      await tx.reconciliation.create({
        data: {
          companyId,
          bankTransactionId: id,
          targetType: r.input.targetType,
          [r.fkField]: r.input.targetId,
          amount: fromCents(r.cents),
          origin,
          createdById: userId,
        } as Prisma.ReconciliationUncheckedCreateInput,
      });
    }

    const sum = already + requested;
    const transferPairId = resolved.find((r) => r.input.targetType === 'TRANSFER')?.input.targetId ?? null;
    await tx.bankTransaction.update({
      where: { id },
      data: {
        reconciledAmount: fromCents(sum),
        status: statusFor(absolute, sum, current.status),
        ...(transferPairId ? { transferPairId } : {}),
      },
    });

    for (const r of resolved) {
      if (r.input.targetType === 'TRANSFER') {
        await tx.bankTransaction.update({
          where: { id: r.input.targetId },
          data: {
            transferPairId: id,
            status: 'RECONCILED',
            reconciledAmount: fromCents(r.totalCents),
          },
        });
      }
    }

    await tx.auditLog.create({
      data: {
        companyId,
        userId,
        action: 'RECONCILE',
        entity: 'bank_transaction',
        entityId: id,
        payload: {
          targets: resolved.map((r) => ({
            targetType: r.input.targetType,
            targetId: r.input.targetId,
            cents: r.cents,
          })),
          origin,
        } as Prisma.InputJsonValue,
      },
    });
  });

  for (const r of resolved) {
    if (r.input.targetType !== 'TRANSFER') {
      await syncTargetFlag(companyId, r.input.targetType, r.input.targetId, r.totalCents);
    }
  }

  const updated = await reload(companyId, id);
  return { transaction: updated, created: resolved.length };
}

export async function undo(
  companyId: string,
  userId: string,
  id: string,
  deleteCreatedEntries = false
) {
  const tx = await ownedTx(companyId, id);
  const pairs = tx.reconciliations
    .filter((r) => r.targetType === 'TRANSFER' && r.pairTransactionId)
    .map((r) => r.pairTransactionId!);

  await prisma.$transaction(async (db) => {
    // Reconciliações PRIMEIRO: FK onDelete:SetNull dispara UPDATE nelas quando o
    // alvo é apagado, e o UPDATE viola o CHECK Reconciliation_one_target.
    await db.reconciliation.deleteMany({ where: { companyId, bankTransactionId: id } });

    if (deleteCreatedEntries) {
      for (const r of tx.reconciliations) {
        if (r.expenseId) {
          await db.expense.deleteMany({
            where: { id: r.expenseId, companyId, source: 'BANK_RECONCILIATION' },
          });
        }
        if (r.otherIncomeId) {
          await db.otherIncome.deleteMany({
            where: { id: r.otherIncomeId, companyId, source: 'BANK_RECONCILIATION' },
          });
        }
      }
    }
    for (const pairId of pairs) {
      await db.bankTransaction.updateMany({
        where: { id: pairId, companyId, transferPairId: id },
        data: { transferPairId: null, status: 'PENDING', reconciledAmount: 0 },
      });
    }
    await db.bankTransaction.update({
      where: { id },
      data: { reconciledAmount: 0, status: 'PENDING', transferPairId: null },
    });
    await db.auditLog.create({
      data: {
        companyId,
        userId,
        action: 'UNRECONCILE',
        entity: 'bank_transaction',
        entityId: id,
        payload: { deleteCreatedEntries } as Prisma.InputJsonValue,
      },
    });
  });

  // Reverte flags dos alvos que ficaram sem reconciliação.
  const seen = new Set<string>();
  for (const r of tx.reconciliations) {
    const field = FK_BY_TYPE[r.targetType];
    if (!field || field === 'pairTransactionId') continue;
    const targetId = r[field];
    if (!targetId || seen.has(`${r.targetType}:${targetId}`)) continue;
    seen.add(`${r.targetType}:${targetId}`);
    const total = await resolveTarget(companyId, { targetType: r.targetType, targetId, amount: 1 });
    if (total) await syncTargetFlag(companyId, r.targetType, targetId, total.totalCents);
  }

  const updated = await reload(companyId, id);
  return { status: updated.status };
}

export interface Suggestion {
  targetType: ReconTargetType;
  targetId: string;
  amount: number;
  score: number;
}

/** Calcula sugestões sob demanda e marca SUGGESTED quando o topo passa de 50. */
export async function buildSuggestions(
  companyId: string,
  id: string,
  cfg: MatchConfig = DEFAULT_MATCH_CONFIG
): Promise<Suggestion[]> {
  const tx = await ownedTx(companyId, id);
  if (tx.status === 'RECONCILED') return [];
  const cands = await loadCandidates(companyId, tx, cfg);

  let suggestions: Suggestion[] = [];
  if (tx.inferredMethod === 'CARD_SETTLEMENT') {
    const absolute = Math.abs(toCents(tx.amount));
    const tol = cardToleranceCents(absolute, cfg.cardTolerancePct);
    const exact = findSubset(cands.map((c) => ({ id: c.id, cents: c.remainingCents })), absolute, 0);
    const ids = exact ?? findSubset(cands.map((c) => ({ id: c.id, cents: c.remainingCents })), absolute, tol);
    suggestions = (ids ?? []).map((cid) => {
      const c = cands.find((x) => x.id === cid)!;
      return { targetType: c.targetType, targetId: c.targetId, amount: toApi(fromCents(c.remainingCents)), score: 100 };
    });
  } else {
    suggestions = cands
      .map((c) => ({
        c,
        score: scoreCandidate(
          {
            cents: toCents(tx.amount),
            postedAt: tx.postedAt,
            inferredMethod: tx.inferredMethod,
            normalizedDescription: tx.normalizedDescription,
            bankAccountId: tx.bankAccountId,
          },
          c,
          { windowDays: cfg.windowDays }
        ),
      }))
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((s) => ({
        targetType: s.c.targetType,
        targetId: s.c.targetId,
        amount: toApi(fromCents(s.c.remainingCents)),
        score: s.score,
      }));
  }

  if (suggestions.length > 0 && suggestions[0].score >= 50 && tx.status === 'PENDING') {
    await prisma.bankTransaction.updateMany({
      where: { id, companyId, status: 'PENDING' },
      data: { status: 'SUGGESTED' },
    });
  }
  return suggestions;
}

export async function bulkConfirm(
  companyId: string,
  userId: string,
  ids: string[],
  cfg: MatchConfig = DEFAULT_MATCH_CONFIG
) {
  const results: Array<{ id: string; reconciled: boolean; reason?: string }> = [];
  for (const id of ids) {
    try {
      const suggestions = await buildSuggestions(companyId, id, cfg);
      if (suggestions.length === 0 || suggestions[0].score < 50) {
        results.push({ id, reconciled: false, reason: 'SEM_SUGESTAO' });
        continue;
      }
      const top = suggestions[0].score;
      const second = suggestions[1]?.score ?? -1;
      // autoConfirm desligado por padrão: exige topo isolado ou folga >= 15.
      if (second >= 0 && top - second < 15) {
        results.push({ id, reconciled: false, reason: 'SUGESTAO_AMBIGUA' });
        continue;
      }
      await reconcile(companyId, userId, id, {
        targets: suggestions.map((s) => ({
          targetType: s.targetType,
          targetId: s.targetId,
          amount: s.amount,
        })),
        origin: 'AUTO',
      });
      results.push({ id, reconciled: true });
    } catch (error) {
      if (error instanceof AppError) {
        results.push({ id, reconciled: false, reason: error.code ?? 'ERRO' });
      } else {
        throw error;
      }
    }
  }
  return { results };
}

export interface CreateEntryInput {
  description: string;
  categoryId: string;
  supplierId?: string | null;
}

/** Cria Expense (saída) ou OtherIncome (entrada) e concilia na mesma transação. */
export async function createEntry(
  companyId: string,
  userId: string,
  id: string,
  input: CreateEntryInput
) {
  const tx = await ownedTx(companyId, id);
  if (tx.status === 'RECONCILED') {
    throw new AppError('Transação já conciliada', 409, 'BANK_TRANSACTION_RECONCILED');
  }
  const category = await prisma.financialCategory.findFirst({
    where: { id: input.categoryId, companyId },
    select: { id: true, kind: true },
  });
  if (!category) throw new AppError('Categoria não encontrada', 404, 'CATEGORY_NOT_FOUND');

  const cents = Math.abs(toCents(tx.amount));
  if (cents === 0) throw new AppError('Valor da transação é zero', 422, 'BANK_TRANSACTION_ZERO');

  const isIn = toCents(tx.amount) > 0;
  const expectedKind = isIn ? 'INCOME' : 'EXPENSE';
  if (category.kind !== expectedKind) {
    throw new AppError(
      `Categoria deve ser do tipo ${expectedKind}`,
      422,
      'CATEGORY_KIND_MISMATCH'
    );
  }

  let entry: { id: string; source: string };
  let targetType: ReconTargetType;
  await prisma.$transaction(async (db) => {
    if (isIn) {
      const created = await db.otherIncome.create({
        data: {
          companyId,
          description: input.description,
          amount: fromCents(cents),
          receivedAt: tx.postedAt,
          categoryId: input.categoryId,
          bankAccountId: tx.bankAccountId,
          source: 'BANK_RECONCILIATION',
          isReconciled: true,
          reconciledAt: new Date(),
        },
      });
      entry = { id: created.id, source: created.source };
      targetType = 'OTHER_INCOME';
    } else {
      const created = await db.expense.create({
        data: {
          companyId,
          description: input.description,
          category: 'BANK_RECONCILIATION',
          categoryId: input.categoryId,
          supplierId: input.supplierId ?? null,
          amount: cents / 100,
          paidAmount: fromCents(cents),
          dueDate: tx.postedAt,
          paidDate: tx.postedAt,
          isPaid: true,
          paymentMethod: 'DEBIT',
          bankAccountId: tx.bankAccountId,
          source: 'BANK_RECONCILIATION',
          isReconciled: true,
          reconciledAt: new Date(),
        },
      });
      entry = { id: created.id, source: created.source };
      targetType = 'EXPENSE';
    }

    const field = FK_BY_TYPE[targetType]!;
    await db.reconciliation.create({
      data: {
        companyId,
        bankTransactionId: id,
        targetType,
        [field]: entry.id,
        amount: fromCents(cents),
        origin: 'MANUAL',
        createdById: userId,
      } as Prisma.ReconciliationUncheckedCreateInput,
    });
    await db.bankTransaction.update({
      where: { id },
      data: { reconciledAmount: fromCents(cents), status: 'RECONCILED' },
    });
    await db.auditLog.create({
      data: {
        companyId,
        userId,
        action: 'CREATE_ENTRY',
        entity: 'bank_transaction',
        entityId: id,
        payload: { entryId: entry.id, targetType } as Prisma.InputJsonValue,
      },
    });
  });

  const updated = await reload(companyId, id);
  return { entry: entry!, transaction: updated };
}

export async function summary(companyId: string) {
  const grouped = await prisma.bankTransaction.groupBy({
    by: ['status'],
    where: { companyId },
    _count: { _all: true },
  });
  const totals = await prisma.bankTransaction.aggregate({
    where: { companyId },
    _sum: { reconciledAmount: true },
  });
  const byStatus = Object.fromEntries(grouped.map((g) => [g.status, g._count._all])) as Record<string, number>;
  return {
    pending: byStatus.PENDING ?? 0,
    suggested: byStatus.SUGGESTED ?? 0,
    partial: byStatus.PARTIAL ?? 0,
    reconciled: byStatus.RECONCILED ?? 0,
    ignored: byStatus.IGNORED ?? 0,
    totalReconciledCents: toCents(totals._sum.reconciledAmount ?? 0),
  };
}
