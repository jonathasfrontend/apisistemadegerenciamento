/**
 * [F1.6] Regras puras do dashboard financeiro — spec:1142-1153.
 *
 * Toda comparação de vencimento usa chave de data em America/Sao_Paulo
 * (D-F1.37), a mesma de `deriveStatus`. Nenhuma classe Prisma entra aqui:
 * o service busca os dados do tenant e este módulo só agrega.
 */
import { fromCents, toApi, toCents } from '../money';
import { dateKeyInSaoPaulo, deriveStatus } from '../payables/status';

export interface OverviewExpense {
  amount: number;
  dueDate: Date;
  isPaid: boolean;
  canceledAt: Date | null;
  paidDate: Date | null;
}

export interface OverviewPayment {
  amount: number;
  status: 'PENDING' | 'PAID' | 'PARTIAL' | 'REFUNDED' | 'CANCELLED';
  paidAt: Date | null;
  canceledAt: Date | null;
  /** Payment CREDIT/DEBIT com parcela já entra em `sumReceivables` — não duplicar. */
  hasCardReceivable: boolean;
}

export interface OverviewOtherIncome {
  amount: number;
  receivedAt: Date;
}

export interface OverviewCardReceivable {
  amount: number;
  expectedDate: Date;
  isReconciled: boolean;
}

export interface OverviewCashSession {
  openedAt: Date;
  expectedCash: number | null;
}

export const dateKey = (date: Date): string => dateKeyInSaoPaulo(date);

const addDays = (date: Date, days: number) => new Date(date.getTime() + days * 86_400_000);

/**
 * Três visões INDEPENDENTES, não buckets excludentes (spec:1150):
 * `overdue` = data passada; `next7Days` = de hoje a +7; `thisMonth` = mês
 * corrente inteiro, incluindo vencidas. É o que o dashboard precisa mostrar.
 */
function bucketsFor(date: Date, today: string, in7Days: string) {
  const key = dateKey(date);
  return {
    overdue: key < today,
    next7Days: key >= today && key <= in7Days,
    thisMonth: key.slice(0, 7) === today.slice(0, 7),
  };
}

type Buckets = { overdue: number; next7Days: number; thisMonth: number };

const emptyBuckets = (): Buckets => ({ overdue: 0, next7Days: 0, thisMonth: 0 });

function addToBucket(acc: Buckets, which: keyof Buckets, cents: number) {
  acc[which] += cents;
}

function present(acc: Buckets) {
  return {
    overdue: toApi(fromCents(acc.overdue)),
    next7Days: toApi(fromCents(acc.next7Days)),
    thisMonth: toApi(fromCents(acc.thisMonth)),
  };
}

/** Σ não pagas: vencidas / vencendo em 7 dias / no mês (spec:1150). */
export function sumPayables(expenses: OverviewExpense[], now: Date) {
  const today = dateKey(now);
  const in7Days = dateKey(addDays(now, 7));
  const acc = emptyBuckets();
  for (const e of expenses) {
    const status = deriveStatus(e, now);
    if (status === 'CANCELED' || status === 'PAID') continue;
    const buckets = bucketsFor(e.dueDate, today, in7Days);
    const cents = toCents(e.amount);
    (Object.keys(buckets) as (keyof Buckets)[]).forEach((key) => {
      if (buckets[key]) addToBucket(acc, key, cents);
    });
  }
  return present(acc);
}

/** Cartões não conciliados por vencimento + pagamentos pendentes sem parcela (spec:1151). */
export function sumReceivables(
  cards: OverviewCardReceivable[],
  payments: OverviewPayment[],
  now: Date
) {
  const today = dateKey(now);
  const in7Days = dateKey(addDays(now, 7));
  const acc = emptyBuckets();
  for (const c of cards) {
    if (c.isReconciled) continue;
    const buckets = bucketsFor(c.expectedDate, today, in7Days);
    const cents = toCents(c.amount);
    (Object.keys(buckets) as (keyof Buckets)[]).forEach((key) => {
      if (buckets[key]) addToBucket(acc, key, cents);
    });
  }
  let pendingCents = 0;
  for (const p of payments) {
    if (p.hasCardReceivable || p.canceledAt) continue;
    if (p.status !== 'PENDING' && p.status !== 'PARTIAL') continue;
    pendingCents += toCents(p.amount);
  }
  const totals = present(acc);
  return {
    cardOverdue: totals.overdue,
    cardNext7Days: totals.next7Days,
    cardThisMonth: totals.thisMonth,
    pendingPayments: toApi(fromCents(pendingCents)),
  };
}

/** Entradas (Payment pago + OtherIncome) x saídas (Expense pago por paidDate) — spec:1152. */
export function sumFlows(
  payments: OverviewPayment[],
  incomes: OverviewOtherIncome[],
  expenses: OverviewExpense[],
  from: Date,
  to: Date
) {
  const inRange = (d: Date | null) => !!d && d.getTime() >= from.getTime() && d.getTime() <= to.getTime();
  let inflows = 0;
  let outflows = 0;
  for (const p of payments) {
    if (p.status === 'PAID' && !p.canceledAt && inRange(p.paidAt)) inflows += toCents(p.amount);
  }
  for (const i of incomes) {
    if (inRange(i.receivedAt)) inflows += toCents(i.amount);
  }
  for (const e of expenses) {
    if (e.isPaid && !e.canceledAt && inRange(e.paidDate)) outflows += toCents(e.amount);
  }
  return {
    inflows: toApi(fromCents(inflows)),
    outflows: toApi(fromCents(outflows)),
    net: toApi(fromCents(inflows - outflows)),
  };
}

/** Alertas: despesas vencidas, caixa aberto >24h, cartões vencidos não conciliados (spec:1153). */
export function buildAlerts(
  expenses: OverviewExpense[],
  cards: OverviewCardReceivable[],
  sessions: OverviewCashSession[],
  now: Date
) {
  const today = dateKey(now);
  return {
    overdueExpenses: expenses.filter((e) => deriveStatus(e, now) === 'OVERDUE').length,
    cashOpenOver24h: sessions.filter((s) => now.getTime() - s.openedAt.getTime() > 86_400_000).length,
    overdueCardReceivables: cards.filter((c) => !c.isReconciled && dateKey(c.expectedDate) < today).length,
  };
}
