/**
 * [F1.4] Status derivado de contas a pagar — spec:1106-1114.
 * Não persistir: o status muda com o tempo sem que a despesa seja escrita.
 * Comparação por chave de data em America/Sao_Paulo (UTC-3, sem DST desde
 * 2019) — usar UTC direto faria 02:00Z de 23/11 parecer 23/11 em SP quando
 * ainda é 22/11 lá. `Intl` já vem no Node: nenhuma dependência nova.
 */

export type PayableStatus = 'CANCELED' | 'PAID' | 'OVERDUE' | 'DUE_TODAY' | 'PENDING';

export interface ExpenseLike {
  canceledAt: Date | null;
  isPaid: boolean;
  dueDate: Date;
}

const SAO_PAULO_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** `YYYY-MM-DD` no fuso de São Paulo — lexicalmente comparável. */
export function dateKeyInSaoPaulo(date: Date): string {
  return SAO_PAULO_DATE.format(date);
}

/** Ordem da spec: cancelado > pago > vencido > vence hoje > pendente. */
export function deriveStatus(expense: ExpenseLike, now: Date): PayableStatus {
  if (expense.canceledAt) return 'CANCELED';
  if (expense.isPaid) return 'PAID';

  const due = dateKeyInSaoPaulo(expense.dueDate);
  const today = dateKeyInSaoPaulo(now);
  if (due < today) return 'OVERDUE';
  if (due === today) return 'DUE_TODAY';
  return 'PENDING';
}
