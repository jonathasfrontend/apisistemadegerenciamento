/**
 * [F1.3] Cálculo de recebíveis de cartão — spec:1058-1098.
 * Exemplo normativo: R$ 300,00 no crédito 3x, 3,99%, confirmado numa segunda.
 */
import { buildCardReceivables } from '../../../src/domain/finance/reconciliation/card-settlement';
import { addDays, nextBusinessDay } from '../../../src/domain/finance/dates';

const ACQUIRER = {
  debitRate: 2,
  creditRate: 2,
  creditInstallmentRate: 3.99,
  installmentRates: null,
  settlementDaysDebit: 1,
  settlementDaysCredit: 30,
  anticipates: false,
};

const CONFIRMED = new Date('2026-11-02T12:00:00.000Z');

describe('buildCardReceivables (F1.3)', () => {
  it('exemplo da spec: 300,00 / 3x / 3,99% → 3×96,01 líquido, taxa 11,97', () => {
    const rows = buildCardReceivables(
      { method: 'CREDIT', amountCents: 30000, installments: 3, confirmedOn: CONFIRMED },
      ACQUIRER
    );

    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.grossCents)).toEqual([10000, 10000, 10000]);
    expect(rows.map((r) => r.feeCents)).toEqual([399, 399, 399]);
    expect(rows.map((r) => r.netCents)).toEqual([9601, 9601, 9601]);
    expect(rows.reduce((sum, r) => sum + r.feeCents, 0)).toBe(1197);
    expect(rows.reduce((sum, r) => sum + r.netCents, 0)).toBe(28803);
    expect(rows.map((r) => r.installmentNumber)).toEqual([1, 2, 3]);
    expect(rows.every((r) => r.installmentTotal === 3)).toBe(true);
  });

  it('datas: D+30/60/90 com nextBusinessDay pulando só fim de semana', () => {
    const rows = buildCardReceivables(
      { method: 'CREDIT', amountCents: 30000, installments: 3, confirmedOn: CONFIRMED },
      ACQUIRER
    );
    // 2027-01-01 é feriado, mas fora do escopo: nextBusinessDay só pula sábado/domingo.
    expect(rows.map((r) => r.expectedDate.toISOString().slice(0, 10))).toEqual([
      '2026-12-02',
      '2027-01-01',
      '2027-02-01', // 31/01/2027 é domingo → 01/02
    ]);
  });

  it('débito é sempre 1 parcela, usa debitRate e settlementDaysDebit', () => {
    const rows = buildCardReceivables(
      { method: 'DEBIT', amountCents: 30000, installments: 3, confirmedOn: CONFIRMED },
      ACQUIRER
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      installmentNumber: 1,
      installmentTotal: 1,
      grossCents: 30000,
      feeCents: 600,
      netCents: 29400,
    });
    expect(rows[0].expectedDate.toISOString().slice(0, 10)).toBe('2026-11-03');
  });

  it('antecipação: todas as parcelas caem em settlementDaysDebit (D+1)', () => {
    const rows = buildCardReceivables(
      { method: 'CREDIT', amountCents: 30000, installments: 3, confirmedOn: CONFIRMED },
      { ...ACQUIRER, anticipates: true }
    );
    expect(rows.map((r) => r.expectedDate.toISOString().slice(0, 10))).toEqual([
      '2026-11-03',
      '2026-11-03',
      '2026-11-03',
    ]);
  });

  it('resto da divisão fica na primeira parcela', () => {
    const rows = buildCardReceivables(
      { method: 'CREDIT', amountCents: 10001, installments: 3, confirmedOn: CONFIRMED },
      { ...ACQUIRER, creditRate: 0 }
    );
    expect(rows.map((r) => r.grossCents)).toEqual([3335, 3333, 3333]);
  });

  it('installmentRates por n sobrescrede creditInstallmentRate', () => {
    const rows = buildCardReceivables(
      { method: 'CREDIT', amountCents: 30000, installments: 3, confirmedOn: CONFIRMED },
      { ...ACQUIRER, installmentRates: { '3': 5 } }
    );
    expect(rows[0].feeCents).toBe(1500);
  });

  it('crédito à vista usa creditRate', () => {
    const rows = buildCardReceivables(
      { method: 'CREDIT', amountCents: 30000, installments: 1, confirmedOn: CONFIRMED },
      ACQUIRER
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].feeCents).toBe(600);
  });
});

describe('datas (F1.3)', () => {
  it('addDays atravessa mês e ano sem depender de timezone local', () => {
    expect(addDays(new Date('2026-12-31T12:00:00Z'), 1).toISOString().slice(0, 10)).toBe('2027-01-01');
    expect(addDays(new Date('2026-11-02T12:00:00Z'), 90).toISOString().slice(0, 10)).toBe('2027-01-31');
  });

  it('nextBusinessDay: sábado e domingo → segunda; dia útil intacto', () => {
    expect(nextBusinessDay(new Date('2026-12-05T12:00:00Z')).toISOString().slice(0, 10)).toBe('2026-12-07');
    expect(nextBusinessDay(new Date('2026-12-06T12:00:00Z')).toISOString().slice(0, 10)).toBe('2026-12-07');
    expect(nextBusinessDay(new Date('2026-12-02T12:00:00Z')).toISOString().slice(0, 10)).toBe('2026-12-02');
  });
});
