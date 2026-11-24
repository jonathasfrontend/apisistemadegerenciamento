/**
 * [F1.4] Status derivado e agendamento de parcelas/recorrência — spec:1106-1129.
 * Puro: sem DB, sem I/O, sem dependência nova. Fuso America/Sao_Paulo importa:
 * 02:00Z de um dia é ainda o dia ANTERIOR em SP (UTC-3).
 */
import { deriveStatus, dateKeyInSaoPaulo } from '../../../src/domain/finance/payables/status';
import {
  buildInstallments,
  buildRecurrenceDates,
} from '../../../src/domain/finance/payables/schedule';

type ExpenseLike = {
  canceledAt: Date | null;
  isPaid: boolean;
  dueDate: Date;
};

const expense = (over: Partial<ExpenseLike> = {}): ExpenseLike => ({
  canceledAt: null,
  isPaid: false,
  dueDate: new Date('2026-11-23T12:00:00.000Z'),
  ...over,
});

describe('deriveStatus (F1.4)', () => {
  it('canceledAt vence até mesmo isPaid', () => {
    const result = deriveStatus(
      expense({ canceledAt: new Date('2026-11-20T12:00:00Z'), isPaid: true }),
      new Date('2026-11-23T12:00:00Z')
    );
    expect(result).toBe('CANCELED');
  });

  it('isPaid → PAID', () => {
    const result = deriveStatus(expense({ isPaid: true }), new Date('2026-11-23T12:00:00Z'));
    expect(result).toBe('PAID');
  });

  it('dueDate no passado → OVERDUE', () => {
    const result = deriveStatus(
      expense({ dueDate: new Date('2026-11-22T12:00:00Z') }),
      new Date('2026-11-23T12:00:00Z')
    );
    expect(result).toBe('OVERDUE');
  });

  it('dueDate hoje em Sao_Paulo → DUE_TODAY (comparação por fuso, não por UTC)', () => {
    // 02:00Z de 23/11 ainda é 22/11 23h em SP: deve ser DUE_TODAY para 22/11.
    expect(dateKeyInSaoPaulo(new Date('2026-11-23T02:00:00.000Z'))).toBe('2026-11-22');
    const result = deriveStatus(
      expense({ dueDate: new Date('2026-11-22T12:00:00Z') }),
      new Date('2026-11-23T02:00:00Z')
    );
    expect(result).toBe('DUE_TODAY');
  });

  it('dueDate no futuro → PENDING', () => {
    const result = deriveStatus(
      expense({ dueDate: new Date('2026-11-24T12:00:00Z') }),
      new Date('2026-11-23T12:00:00Z')
    );
    expect(result).toBe('PENDING');
  });
});

describe('buildInstallments (F1.4)', () => {
  it('resto na primeira parcela; soma exata sem centavos perdidos', () => {
    const rows = buildInstallments(10000, 3, new Date('2026-01-31T12:00:00.000Z'));

    expect(rows.map((r) => r.amountCents)).toEqual([3334, 3333, 3333]);
    expect(rows.reduce((sum, r) => sum + r.amountCents, 0)).toBe(10000);
    expect(rows.every((r) => r.installmentTotal === 3)).toBe(true);
    expect(rows.map((r) => r.installmentNumber)).toEqual([1, 2, 3]);
  });

  it('clamp de dia 31 → último dia do mês, retomando 31 no mês seguinte', () => {
    const rows = buildInstallments(300, 3, new Date('2026-01-31T12:00:00.000Z'));

    expect(rows.map((r) => r.dueDate.toISOString().slice(0, 10))).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
    ]);
  });

  it('nº de parcelas e valor total coerentes mesmo com centavos ímpares', () => {
    const rows = buildInstallments(1, 3, new Date('2026-01-05T12:00:00.000Z'));
    expect(rows.map((r) => r.amountCents)).toEqual([1, 0, 0]);
    expect(rows.reduce((sum, r) => sum + r.amountCents, 0)).toBe(1);
  });
});

describe('buildRecurrenceDates (F1.4)', () => {
  const from = new Date('2026-01-01T00:00:00.000Z');
  const until = new Date('2026-04-30T00:00:00.000Z');

  it('MONTHLY mantém o dia original e clampa 31 em fevereiro', () => {
    const dates = buildRecurrenceDates(
      new Date('2026-01-31T12:00:00Z'),
      'MONTHLY',
      from,
      until
    );
    expect(dates.map((d) => d.toISOString().slice(0, 10))).toEqual([
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
    ]);
  });

  it('WEEKLY e YEARLY respeitam o intervalo e o horizonte', () => {
    const weekly = buildRecurrenceDates(
      new Date('2026-01-05T12:00:00Z'),
      'WEEKLY',
      from,
      new Date('2026-01-20T00:00:00Z')
    );
    expect(weekly.map((d) => d.toISOString().slice(0, 10))).toEqual([
      '2026-01-12',
      '2026-01-19',
    ]);

    const yearly = buildRecurrenceDates(
      new Date('2024-02-29T12:00:00Z'),
      'YEARLY',
      from,
      new Date('2027-12-31T00:00:00Z')
    );
    // from=2026-01-01: 2025-02-28 fica fora do horizonte por definição.
    expect(yearly.map((d) => d.toISOString().slice(0, 10))).toEqual([
      '2026-02-28',
      '2027-02-28',
    ]);
  });

  it('função é determinística: mesma chamada devolve as mesmas datas', () => {
    const first = new Date('2026-01-10T12:00:00Z');
    expect(buildRecurrenceDates(first, 'MONTHLY', from, until)).toEqual(
      buildRecurrenceDates(first, 'MONTHLY', from, until)
    );
  });
});
