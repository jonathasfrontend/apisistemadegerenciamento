/**
 * [F1.2] Fechamento de caixa — cálculo puro, sem Prisma sem I/O.
 * Especificação: FINANCEIRO_IMPLEMENTACAO.md:998-1026 (C5/C7).
 */
import { Prisma } from '@prisma/client';
import { toCents } from '../money';

export interface Mv {
  direction: 'IN' | 'OUT';
  cents: number;
  voided: boolean;
}

export interface Totals {
  totalIn: number;
  totalOut: number;
  expected: number;
}

/** Movimentos anulados nunca entram em totalIn/totalOut/expected. */
export function computeTotals(openingCents: number, movements: Mv[]): Totals {
  const active = movements.filter((m) => !m.voided);
  const totalIn = active
    .filter((m) => m.direction === 'IN')
    .reduce((sum, m) => sum + m.cents, 0);
  const totalOut = active
    .filter((m) => m.direction === 'OUT')
    .reduce((sum, m) => sum + m.cents, 0);
  return { totalIn, totalOut, expected: openingCents + totalIn - totalOut };
}

export function computeClosing(
  openingCents: number,
  movements: Mv[],
  countedCents: number
): Totals & { difference: number } {
  const totals = computeTotals(openingCents, movements);
  return { ...totals, difference: countedCents - totals.expected }; // + sobra / − falta
}

export interface PaymentForSummary {
  method: string;
  amount: Prisma.Decimal.Value;
  status: string;
}

/** C7: só pagamentos confirmados entram no resumo por método (centavos). */
export function summarizeByMethod(payments: PaymentForSummary[]): Record<string, number> {
  const summary: Record<string, number> = {};
  for (const payment of payments) {
    if (payment.status !== 'PAID') continue;
    const method = String(payment.method);
    summary[method] = (summary[method] ?? 0) + toCents(payment.amount);
  }
  return summary;
}
