/**
 * [F1.5] Projeção pura da visão unificada de a receber — spec:1133-1140.
 *
 * `Payment` não tem `dueDate`: para cartão, a data prevista é o menor
 * `CardReceivable.expectedDate` não conciliado; nos demais casos, `paidAt ??
 * createdAt`. `OtherIncome` usa `receivedAt`. Status é derivado (não persistido)
 * com chave de data em America/Sao_Paulo — mesma regra dos pagaveis (D-F1.37).
 */
import { fromCents, toApi, toCents } from '../money';
import { dateKeyInSaoPaulo } from '../payables/status';

export type ReceivableKind = 'PAYMENT' | 'OTHER_INCOME';
export type ReceivableStatus = 'PENDING' | 'PAID' | 'OVERDUE' | 'REFUNDED';
export type ReceivableMethod = 'CASH' | 'DEBIT' | 'CREDIT' | 'PIX' | 'LINK' | 'WALLET';

export interface UnifiedReceivable {
  id: string;
  kind: ReceivableKind;
  description: string;
  clientName: string | null;
  amount: number;
  method: ReceivableMethod | null;
  status: ReceivableStatus;
  expectedDate: Date;
  isReconciled: boolean;
  netAmount: number | null;
  feeAmount: number | null;
  acquirerId: string | null;
}

/** Forma mínima de Payment — o service faz o join do nome do cliente. */
export interface PaymentLike {
  id: string;
  companyId: string;
  amount: number;
  method: ReceivableMethod;
  status: 'PENDING' | 'PAID' | 'PARTIAL' | 'REFUNDED' | 'CANCELLED';
  isReconciled: boolean;
  canceledAt: Date | null;
  paidAt: Date | null;
  createdAt: Date;
  feeAmount: number | null;
  netAmount: number | null;
  acquirerId: string | null;
  clientName: string;
}

/** Forma mínima de CardReceivable para escolher a parcela norteadora. */
export interface CardReceivableLike {
  expectedDate: Date;
  isReconciled: boolean;
  feeAmount: number;
  netAmount: number;
  acquirerId: string;
}

export interface OtherIncomeLike {
  id: string;
  description: string;
  amount: number;
  receivedAt: Date;
  isReconciled: boolean;
}

function derivePaymentStatus(
  payment: PaymentLike,
  expectedDate: Date,
  now: Date
): ReceivableStatus {
  if (payment.status === 'REFUNDED' || payment.status === 'CANCELLED' || payment.canceledAt) {
    return 'REFUNDED';
  }
  if (payment.status === 'PAID') return 'PAID';
  // PENDING / PARTIAL: vencido quando a data prevista já passou em São Paulo.
  return dateKeyInSaoPaulo(expectedDate) < dateKeyInSaoPaulo(now) ? 'OVERDUE' : 'PENDING';
}

export function projectPayment(
  payment: PaymentLike,
  receivables: CardReceivableLike[],
  now: Date
): UnifiedReceivable {
  const minByDate = (rows: CardReceivableLike[]) =>
    rows.reduce<CardReceivableLike | null>((min, r) => {
      if (!min || r.expectedDate.getTime() < min.expectedDate.getTime()) return r;
      return min;
    }, null);

  // Data prevista: menor parcela NÃO conciliada (spec:1136).
  const expectedSource = minByDate(receivables.filter((r) => !r.isReconciled));
  // Taxa/adquirente: parcela norteadora. `payment.feeAmount` é a SOMA das
  // parcelas (finance-hooks.service:145); usá-la só quando não há parcela
  // faria a taxa saltar de 3 para 9 ao conciliar a 1ª de 3 (D-F1.52).
  const feeSource = expectedSource ?? minByDate(receivables);

  const hasCard = payment.method === 'CREDIT' || payment.method === 'DEBIT';
  const expectedDate =
    hasCard && expectedSource ? expectedSource.expectedDate : payment.paidAt ?? payment.createdAt;

  return {
    id: payment.id,
    kind: 'PAYMENT',
    description: `Pagamento ${payment.method}`,
    clientName: payment.clientName,
    amount: payment.amount,
    method: payment.method,
    status: derivePaymentStatus(payment, expectedDate, now),
    expectedDate,
    isReconciled: payment.isReconciled,
    netAmount: hasCard && feeSource ? feeSource.netAmount : payment.netAmount,
    feeAmount: hasCard && feeSource ? feeSource.feeAmount : payment.feeAmount,
    acquirerId: hasCard && feeSource ? feeSource.acquirerId : payment.acquirerId,
  };
}

export function projectOtherIncome(income: OtherIncomeLike): UnifiedReceivable {
  return {
    id: income.id,
    kind: 'OTHER_INCOME',
    description: income.description,
    clientName: null,
    amount: income.amount,
    method: null,
    status: 'PAID',
    expectedDate: income.receivedAt,
    isReconciled: income.isReconciled,
    netAmount: null,
    feeAmount: null,
    acquirerId: null,
  };
}

export interface ReceivableSummary {
  totalExpected: number;
  totalReceived: number;
  totalOverdue: number;
  cardFees: number;
}

/** Resumo calculado SOBRE a lista já filtrada, antes da paginação (aceite F1.5). */
export function summarizeReceivables(rows: readonly UnifiedReceivable[]): ReceivableSummary {
  // Decimal → centavos inteiros → Decimal → number: evita 0.10 + 0.20 = 0.30000000000000004.
  const totals = rows.reduce(
    (sum, r) => {
      const cents = toCents(r.amount);
      return {
        expected: sum.expected + cents,
        received: sum.received + (r.status === 'PAID' ? cents : 0),
        overdue: sum.overdue + (r.status === 'OVERDUE' ? cents : 0),
        fees: sum.fees + (r.feeAmount !== null ? toCents(r.feeAmount) : 0),
      };
    },
    { expected: 0, received: 0, overdue: 0, fees: 0 }
  );
  return {
    totalExpected: toApi(fromCents(totals.expected)),
    totalReceived: toApi(fromCents(totals.received)),
    totalOverdue: toApi(fromCents(totals.overdue)),
    cardFees: toApi(fromCents(totals.fees)),
  };
}
