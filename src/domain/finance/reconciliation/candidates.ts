/**
 * [F2.5] Alvos candidatos — spec §7.6.1 (FINANCEIRO_IMPLEMENTACAO.md:1346-1353).
 *
 * Entrada: Payment não-cartão pago, CardReceivable, OtherIncome, CashMovement
 * com conta, transferência de outra conta própria.
 * Saída: Expense paga (paymentMethod ≠ CASH) e transferência.
 *
 * Restrições: mesma empresa; mesmo bankAccountId quando o candidato tem conta;
 * janela ±matchWindowDays. `remainingCents` já desconta reconciliações
 * anteriores (I5), então o engine pode confiar no valor livre.
 */
import { Prisma, ReconTargetType } from '@prisma/client';
import prisma from '../../../config/db';
import { toCents } from '../money';
import { type ScoreCandidate } from './scoring';

export interface Candidate extends ScoreCandidate {
  targetType: ReconTargetType;
  targetId: string;
  /** Valor total do alvo em centavos (para I5 e ajuste de cartão). */
  totalCents: number;
}

export interface CandidateConfig {
  windowDays: number;
}

const DAY = 86_400_000;

type ReconField =
  | 'paymentId'
  | 'cardReceivableId'
  | 'expenseId'
  | 'otherIncomeId'
  | 'cashMovementId'
  | 'pairTransactionId';

/** Soma já conciliada por alvo, em centavos. Um groupBy por tipo evita N+1. */
async function reconciledBy(
  companyId: string,
  field: ReconField,
  ids: string[]
): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const rows = (await prisma.reconciliation.groupBy({
    by: [field],
    where: { companyId, [field]: { in: ids } } as Prisma.ReconciliationWhereInput,
    _sum: { amount: true },
  })) as unknown as Array<Record<string, unknown> & { _sum: { amount: Prisma.Decimal | null } }>;
  return new Map(
    rows.map((r) => [String(r[field]), toCents(r._sum.amount ?? 0)])
  );
}

export async function loadCandidates(
  companyId: string,
  tx: {
    id: string;
    postedAt: Date;
    amount: Prisma.Decimal;
    inferredMethod: string;
    normalizedDescription: string;
    bankAccountId: string;
  },
  cfg: CandidateConfig
): Promise<Candidate[]> {
  const cents = toCents(tx.amount);
  const isIn = cents > 0;
  const from = new Date(tx.postedAt.getTime() - cfg.windowDays * DAY);
  const to = new Date(tx.postedAt.getTime() + cfg.windowDays * DAY);
  const out: Candidate[] = [];

  if (isIn) {
    // Payment não-cartão, pago, não conciliado.
    const payments = await prisma.payment.findMany({
      where: {
        companyId,
        status: 'PAID',
        isReconciled: false,
        canceledAt: null,
        method: { not: 'CREDIT' },
        paidAt: { gte: from, lte: to },
        OR: [{ bankAccountId: tx.bankAccountId }, { bankAccountId: null }],
      },
      select: {
        id: true,
        amount: true,
        method: true,
        paidAt: true,
        bankAccountId: true,
        client: { select: { name: true } },
      },
    });
    const pSum = await reconciledBy(companyId, 'paymentId', payments.map((p) => p.id));
    for (const p of payments) {
      const total = toCents(p.amount);
      const used = pSum.get(p.id) ?? 0;
      if (total - used <= 0) continue;
      out.push({
        id: p.id,
        targetType: 'PAYMENT',
        targetId: p.id,
        totalCents: total,
        remainingCents: total - used,
        date: p.paidAt ?? tx.postedAt,
        method: p.method,
        counterpartyName: p.client?.name ?? null,
        bankAccountId: p.bankAccountId ?? null,
      });
    }

    // CardReceivable — janela um pouco mais larga conforme §7.6.3.
    const cardFrom = new Date(tx.postedAt.getTime() - (cfg.windowDays + 2) * DAY);
    const cardTo = new Date(tx.postedAt.getTime() + 2 * DAY);
    const receivables = await prisma.cardReceivable.findMany({
      where: {
        companyId,
        isReconciled: false,
        expectedDate: { gte: cardFrom, lte: cardTo },
      },
      select: {
        id: true,
        netAmount: true,
        expectedDate: true,
        payment: { select: { client: { select: { name: true } } } },
      },
    });
    const rSum = await reconciledBy(companyId, 'cardReceivableId', receivables.map((r) => r.id));
    for (const r of receivables) {
      const total = toCents(r.netAmount);
      const used = rSum.get(r.id) ?? 0;
      if (total - used <= 0) continue;
      out.push({
        id: r.id,
        targetType: 'CARD_RECEIVABLE',
        targetId: r.id,
        totalCents: total,
        remainingCents: total - used,
        date: r.expectedDate,
        method: 'CARD_SETTLEMENT',
        counterpartyName: r.payment?.client?.name ?? null,
        bankAccountId: null,
      });
    }

    // OtherIncome não conciliada.
    const incomes = await prisma.otherIncome.findMany({
      where: {
        companyId,
        isReconciled: false,
        bankAccountId: tx.bankAccountId,
        receivedAt: { gte: from, lte: to },
      },
      select: {
        id: true,
        amount: true,
        description: true,
        receivedAt: true,
        bankAccountId: true,
      },
    });
    const iSum = await reconciledBy(companyId, 'otherIncomeId', incomes.map((i) => i.id));
    for (const i of incomes) {
      const total = toCents(i.amount);
      const used = iSum.get(i.id) ?? 0;
      if (total - used <= 0) continue;
      out.push({
        id: i.id,
        targetType: 'OTHER_INCOME',
        targetId: i.id,
        totalCents: total,
        remainingCents: total - used,
        date: i.receivedAt,
        method: null,
        counterpartyName: i.description,
        bankAccountId: i.bankAccountId ?? null,
      });
    }

    // CashMovement de depósito (direção IN) com conta informada.
    const movements = await prisma.cashMovement.findMany({
      where: {
        companyId,
        isReconciled: false,
        voidedAt: null,
        direction: 'IN',
        bankAccountId: tx.bankAccountId,
        occurredAt: { gte: from, lte: to },
      },
      select: {
        id: true,
        amount: true,
        description: true,
        occurredAt: true,
        bankAccountId: true,
      },
    });
    const mSum = await reconciledBy(companyId, 'cashMovementId', movements.map((m) => m.id));
    for (const m of movements) {
      const total = toCents(m.amount);
      const used = mSum.get(m.id) ?? 0;
      if (total - used <= 0) continue;
      out.push({
        id: m.id,
        targetType: 'CASH_MOVEMENT',
        targetId: m.id,
        totalCents: total,
        remainingCents: total - used,
        date: m.occurredAt,
        method: 'CASH_DEPOSIT',
        counterpartyName: m.description,
        bankAccountId: m.bankAccountId ?? null,
      });
    }
  } else {
    // Expense paga, não conciliada, paymentMethod ≠ CASH.
    const expenses = await prisma.expense.findMany({
      where: {
        companyId,
        isPaid: true,
        isReconciled: false,
        canceledAt: null,
        paymentMethod: { not: 'CASH' },
        paidDate: { gte: from, lte: to },
        OR: [{ bankAccountId: tx.bankAccountId }, { bankAccountId: null }],
      },
      select: {
        id: true,
        amount: true,
        paidAmount: true,
        paidDate: true,
        description: true,
        paymentMethod: true,
        bankAccountId: true,
        supplier: { select: { name: true } },
      },
    });
    const eSum = await reconciledBy(companyId, 'expenseId', expenses.map((e) => e.id));
    for (const e of expenses) {
      const total = toCents(e.paidAmount ?? e.amount);
      const used = eSum.get(e.id) ?? 0;
      if (total - used <= 0) continue;
      out.push({
        id: e.id,
        targetType: 'EXPENSE',
        targetId: e.id,
        totalCents: total,
        remainingCents: total - used,
        date: e.paidDate ?? from,
        method: e.paymentMethod ?? null,
        counterpartyName: e.supplier?.name ?? e.description,
        bankAccountId: e.bankAccountId ?? null,
      });
    }
  }

  // Transferência entre contas próprias: sinal oposto, mesmo valor, outra conta,
  // até 2 dias de distância e sem par já definido (§7.6.4).
  const transferFrom = new Date(tx.postedAt.getTime() - 2 * DAY);
  const transferTo = new Date(tx.postedAt.getTime() + 2 * DAY);
  const pairs = await prisma.bankTransaction.findMany({
    where: {
      companyId,
      bankAccountId: { not: tx.bankAccountId },
      amount: { equals: fromCentsRaw(-cents) },
      postedAt: { gte: transferFrom, lte: transferTo },
      transferPairId: null,
      id: { not: tx.id },
    },
    select: {
      id: true,
      amount: true,
      postedAt: true,
      bankAccountId: true,
      reconciledAmount: true,
      description: true,
    },
  });
  const tSum = await reconciledBy(companyId, 'pairTransactionId', pairs.map((p) => p.id));
  for (const p of pairs) {
    const total = Math.abs(toCents(p.amount));
    const used = tSum.get(p.id) ?? 0;
    if (total - used <= 0) continue;
    out.push({
      id: p.id,
      targetType: 'TRANSFER',
      targetId: p.id,
      totalCents: total,
      remainingCents: total - used,
      date: p.postedAt,
      method: 'TED',
      counterpartyName: p.description,
      bankAccountId: p.bankAccountId,
    });
  }

  return out;
}

/** centavos → number com 2 casas para filtro `equals` do Prisma. */
const fromCentsRaw = (cents: number): number => cents / 100;
