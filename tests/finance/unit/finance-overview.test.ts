/**
 * [F1.6] Regras puras do dashboard financeiro — spec:1142-1153.
 * Nenhuma dependência de DB: o service só buscou os dados e aplica estas funções.
 */
import {
  sumPayables,
  sumReceivables,
  sumFlows,
  buildAlerts,
  dateKey,
  OverviewExpense,
  OverviewPayment,
  OverviewCardReceivable,
  OverviewCashSession,
} from '../../../src/domain/finance/reports/overview';

const NOW = new Date('2026-11-23T12:00:00.000Z');

const expense = (amount: number, dueDate: string, extra: Partial<OverviewExpense> = {}): OverviewExpense => ({
  amount,
  dueDate: new Date(dueDate),
  isPaid: false,
  canceledAt: null,
  paidDate: null,
  ...extra,
});

const payment = (amount: number, extra: Partial<OverviewPayment> = {}): OverviewPayment => ({
  amount,
  status: 'PENDING',
  paidAt: null,
  canceledAt: null,
  hasCardReceivable: false,
  ...extra,
});

const card = (amount: number, expectedDate: string, isReconciled = false): OverviewCardReceivable => ({
  amount,
  expectedDate: new Date(expectedDate),
  isReconciled,
});

describe('sumPayables (F1.6)', () => {
  it('separa vencidas, 7 dias e mês; ignora pagas e canceladas', () => {
    const rows = [
      expense(100, '2026-11-20T12:00:00Z'),
      expense(50, '2026-11-25T12:00:00Z'),
      expense(30, '2026-11-30T12:00:00Z'),
      expense(999, '2026-11-20T12:00:00Z', { isPaid: true }),
      expense(888, '2026-11-20T12:00:00Z', { canceledAt: new Date('2026-11-21T12:00:00Z') }),
    ];
    // `thisMonth` é visão inclusiva: todas as não pagas com vencimento no mês.
    // 30/11 está exatamente a +7 dias; `thisMonth` inclui vencidas e 7 dias.
    expect(sumPayables(rows, NOW)).toEqual({ overdue: 100, next7Days: 80, thisMonth: 180 });
  });

  it('usa chave de data em São Paulo, não UTC', () => {
    const spNow = new Date('2026-11-23T02:00:00.000Z'); // 22/11 23:00 em SP
    expect(dateKey(spNow)).toBe('2026-11-22');
    // Vencimento 22/11 09:00 em SP é HOJE nesse instante — não é vencido.
    const rows = [expense(70, '2026-11-22T12:00:00Z')];
    expect(sumPayables(rows, spNow)).toEqual({ overdue: 0, next7Days: 70, thisMonth: 70 });
  });
});

describe('sumReceivables (F1.6)', () => {
  it('agrupa cartões não conciliados e não duplica Payment com parcela', () => {
    const cards = [
      card(200, '2026-11-20T12:00:00Z'),
      card(100, '2026-11-25T12:00:00Z'),
      card(50, '2026-12-05T12:00:00Z'),
      card(777, '2026-11-20T12:00:00Z', true),
    ];
    const payments = [
      payment(60),
      payment(999, { hasCardReceivable: true }),
      payment(888, { status: 'PAID', paidAt: NOW }),
    ];
    expect(sumReceivables(cards, payments, NOW)).toEqual({
      cardOverdue: 200,
      cardNext7Days: 100,
      cardThisMonth: 300,
      pendingPayments: 60,
    });
  });
});

describe('sumFlows (F1.6)', () => {
  const from = new Date('2026-11-01T00:00:00Z');
  const to = new Date('2026-11-30T23:59:59.999Z');

  it('só conta pagamentos pagos, receitas avulsas e despesas pagas no período', () => {
    const payments = [
      payment(100, { status: 'PAID', paidAt: new Date('2026-11-15T12:00:00Z') }),
      payment(900, { status: 'PAID', paidAt: new Date('2026-10-31T12:00:00Z') }),
      payment(800),
    ];
    const incomes = [{ amount: 50, receivedAt: new Date('2026-11-20T00:00:00Z') }];
    const expenses = [
      expense(30, '2026-11-18T12:00:00Z', { isPaid: true, paidDate: new Date('2026-11-18T12:00:00Z') }),
      expense(700, '2026-10-31T12:00:00Z', { isPaid: true, paidDate: new Date('2026-10-31T12:00:00Z') }),
    ];
    expect(sumFlows(payments, incomes, expenses, from, to)).toEqual({
      inflows: 150,
      outflows: 30,
      net: 120,
    });
  });

  it('acumula em centavos — 0.10 + 0.20 é exatamente 0.30', () => {
    const payments = [
      payment(0.1, { status: 'PAID', paidAt: new Date('2026-11-15T12:00:00Z') }),
      payment(0.2, { status: 'PAID', paidAt: new Date('2026-11-16T12:00:00Z') }),
    ];
    expect(sumFlows(payments, [], [], from, to).inflows).toBe(0.3);
  });
});

describe('buildAlerts (F1.6)', () => {
  it('conta vencidas, caixas abertos há mais de 24h e cartões vencidos', () => {
    const expenses = [
      expense(10, '2026-11-20T12:00:00Z'),
      expense(20, '2026-11-21T12:00:00Z'),
      expense(30, '2026-11-25T12:00:00Z'),
      expense(40, '2026-11-20T12:00:00Z', { isPaid: true }),
    ];
    const cards = [
      card(200, '2026-11-20T12:00:00Z'),
      card(100, '2026-11-25T12:00:00Z'),
      card(50, '2026-11-20T12:00:00Z', true),
    ];
    const sessions: OverviewCashSession[] = [
      { openedAt: new Date('2026-11-22T10:00:00Z'), expectedCash: 100 }, // 26h
      { openedAt: new Date('2026-11-23T10:00:00Z'), expectedCash: 50 }, // 2h
    ];
    expect(buildAlerts(expenses, cards, sessions, NOW)).toEqual({
      overdueExpenses: 2,
      cashOpenOver24h: 1,
      overdueCardReceivables: 1,
    });
  });
});
