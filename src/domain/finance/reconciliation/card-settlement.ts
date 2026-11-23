/**
 * [F1.3] Cálculo puro de recebíveis de cartão — spec:1058-1098.
 * Centro de custo: nenhuma I/O, nenhum Prisma. Valores em centavos inteiros;
 * arredondamento de taxa com Math.round (HALF_UP para positivos).
 */
import { addDays, nextBusinessDay } from '../dates';

export interface CardPaymentInput {
  method: 'DEBIT' | 'CREDIT';
  amountCents: number;
  installments: number;
  confirmedOn: Date;
}

export interface CardAcquirerInput {
  debitRate: number; // % (ex.: 2.0)
  creditRate: number; // % (ex.: 2.0)
  creditInstallmentRate?: number | null;
  installmentRates?: Record<string, number> | null;
  settlementDaysDebit: number;
  settlementDaysCredit: number;
  anticipates: boolean;
}

export interface CardReceivableRow {
  installmentNumber: number;
  installmentTotal: number;
  grossCents: number;
  feeCents: number;
  netCents: number;
  expectedDate: Date;
}

/** Resto da divisão fica na PRIMEIRA parcela (spec:1075). */
function split(total: number, n: number): number[] {
  const base = Math.floor(total / n);
  return Array.from({ length: n }, (_, i) => (i === 0 ? total - base * (n - 1) : base));
}

export function buildCardReceivables(
  p: CardPaymentInput,
  a: CardAcquirerInput
): CardReceivableRow[] {
  const n = p.method === 'DEBIT' ? 1 : Math.max(1, p.installments);
  const rate =
    p.method === 'DEBIT'
      ? a.debitRate
      : n === 1
        ? a.creditRate
        : (a.installmentRates?.[String(n)] ?? a.creditInstallmentRate ?? a.creditRate);

  const fee = Math.round((p.amountCents * rate) / 100);
  const net = p.amountCents - fee;
  const gross = split(p.amountCents, n);
  const fees = split(fee, n);
  const nets = split(net, n);

  return Array.from({ length: n }, (_, i) => {
    const days =
      p.method === 'DEBIT'
        ? a.settlementDaysDebit
        : a.anticipates
          ? a.settlementDaysDebit
          : a.settlementDaysCredit * (i + 1);
    return {
      installmentNumber: i + 1,
      installmentTotal: n,
      grossCents: gross[i],
      feeCents: fees[i],
      netCents: nets[i],
      expectedDate: nextBusinessDay(addDays(p.confirmedOn, days)),
    };
  });
}
