/**
 * [F1.4] Agendamento de parcelas e recorrência — spec:1123-1125 (P4/P5).
 * Puro: sem I/O, sem DB. Toda data gerada é meio-dia UTC para que a chave
 * `@@unique([recurrenceParentId, dueDate])` seja estável entre execuções do
 * job (D-F1.36): meia-noite é vulnerável a deslocamento de fuso no driver.
 */
import { RecurrenceInterval } from '@prisma/client';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface InstallmentRow {
  amountCents: number;
  dueDate: Date;
  installmentNumber: number;
  installmentTotal: number;
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/** Dia original clampado ao último dia do mês; mês seguinte retoma o dia 31. */
function atMonthDay(year: number, monthIndex: number, day: number): Date {
  return new Date(Date.UTC(year, monthIndex, Math.min(day, daysInMonth(year, monthIndex)), 12));
}

/** Resto na primeira parcela (D-F1.20/Task 6): soma exata, sem centavo perdido. */
export function buildInstallments(
  amountCents: number,
  count: number,
  firstDueDate: Date
): InstallmentRow[] {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error('installment count deve ser inteiro >= 1');
  }

  const base = Math.floor(amountCents / count);
  const remainder = amountCents - base * count;
  const day = firstDueDate.getUTCDate();
  const year = firstDueDate.getUTCFullYear();
  const month = firstDueDate.getUTCMonth();

  return Array.from({ length: count }, (_, index) => ({
    amountCents: base + (index === 0 ? remainder : 0),
    dueDate: atMonthDay(year, month + index, day),
    installmentNumber: index + 1,
    installmentTotal: count,
  }));
}

/**
 * Ocorrências posteriores à data original, entre `from` e `until` (inclusive).
 * Determinística: mesma entrada → mesmas datas → `skipDuplicates` idempotente.
 */
export function buildRecurrenceDates(
  startDate: Date,
  interval: RecurrenceInterval,
  from: Date,
  until: Date
): Date[] {
  const day = startDate.getUTCDate();
  const month = startDate.getUTCMonth();
  const year = startDate.getUTCFullYear();
  // Horizonte é data, não instante: `until=2026-04-30T00:00Z` deve incluir
  // 30/04 mesmo com a ocorrência gerada às 12:00Z (bug de fronteira visto no RED).
  const lower = from.toISOString().slice(0, 10);
  const upper = until.toISOString().slice(0, 10);
  const dates: Date[] = [];

  if (interval === 'WEEKLY') {
    const step = 7 * DAY_MS;
    let cursor = Date.UTC(year, month, day + 7, 12);
    for (let guard = 0; guard < 600; guard += 1) {
      const stamp = new Date(cursor).toISOString().slice(0, 10);
      if (stamp > upper) break;
      if (stamp >= lower) dates.push(new Date(cursor));
      cursor += step;
    }
    return dates;
  }

  if (interval === 'MONTHLY' || interval === 'YEARLY') {
    for (let index = 1; index <= 1200; index += 1) {
      const cursor =
        interval === 'MONTHLY'
          ? atMonthDay(year, month + index, day).getTime()
          : atMonthDay(year + index, month, day).getTime();
      const stamp = new Date(cursor).toISOString().slice(0, 10);
      if (stamp > upper) break;
      if (stamp >= lower) dates.push(new Date(cursor));
    }
  }

  return dates;
}
