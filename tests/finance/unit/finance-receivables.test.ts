/**
 * [F1.5] Projeção unificada de recebíveis — spec:1133-1140.
 * Testa a regra pura: expectedDate por origem, status derivado (4 valores),
 * resumo sobre a lista filtrada e seleção do menor CardReceivable não conciliado.
 */
import {
  projectPayment,
  projectOtherIncome,
  summarizeReceivables,
  UnifiedReceivable,
} from '../../../src/domain/finance/receivables/project';

const NOW = new Date('2026-11-23T12:00:00.000Z');

describe('projectPayment (F1.5)', () => {
  const base = {
    id: 'p1',
    companyId: 'c1',
    amount: 100,
    method: 'PIX' as const,
    status: 'PENDING' as const,
    isReconciled: false,
    canceledAt: null,
    paidAt: null,
    createdAt: new Date('2026-11-01T12:00:00Z'),
    feeAmount: null,
    netAmount: null,
    acquirerId: null,
    clientName: 'Cliente A',
  };

  it('PENDING sem card receivable usa createdAt como expectedDate', () => {
    const r = projectPayment(base, [], NOW);
    expect(r.kind).toBe('PAYMENT');
    expect(r.expectedDate.toISOString()).toBe('2026-11-01T12:00:00.000Z');
    expect(r.status).toBe('OVERDUE');
    expect(r.clientName).toBe('Cliente A');
    expect(r.netAmount).toBeNull();
  });

  it('PAID usa paidAt e status PAID', () => {
    const r = projectPayment(
      { ...base, status: 'PAID', paidAt: new Date('2026-11-20T12:00:00Z') },
      [],
      NOW
    );
    expect(r.status).toBe('PAID');
    expect(r.expectedDate.toISOString()).toBe('2026-11-20T12:00:00.000Z');
  });

  it('cartão escolhe o MENOR expectedDate não conciliado (spec:1136)', () => {
    const r = projectPayment(
      { ...base, method: 'CREDIT', status: 'PAID', paidAt: new Date('2026-11-01T12:00:00Z') },
      [
        { expectedDate: new Date('2026-12-10T00:00:00Z'), isReconciled: false, feeAmount: 3, netAmount: 97, acquirerId: 'aq1' },
        { expectedDate: new Date('2026-12-20T00:00:00Z'), isReconciled: false, feeAmount: 6, netAmount: 94, acquirerId: 'aq1' },
        { expectedDate: new Date('2026-11-05T00:00:00Z'), isReconciled: true, feeAmount: 1, netAmount: 99, acquirerId: 'aq1' },
      ],
      NOW
    );
    expect(r.expectedDate.toISOString()).toBe('2026-12-10T00:00:00.000Z');
    expect(r.feeAmount).toBe(3);
    expect(r.netAmount).toBe(97);
    expect(r.acquirerId).toBe('aq1');
  });

  it('cartão com todos conciliados cai para paidAt mas mantém a taxa da parcela', () => {
    const r = projectPayment(
      { ...base, method: 'DEBIT', status: 'PAID', paidAt: new Date('2026-11-02T12:00:00Z') },
      [{ expectedDate: new Date('2026-11-03T00:00:00Z'), isReconciled: true, feeAmount: 2, netAmount: 98, acquirerId: 'aq1' }],
      NOW
    );
    expect(r.expectedDate.toISOString()).toBe('2026-11-02T12:00:00.000Z');
    // payment.feeAmount é a SOMA das parcelas; a taxa do período é por parcela.
    expect(r.feeAmount).toBe(2);
    expect(r.acquirerId).toBe('aq1');
  });

  it('sem CardReceivable, acquirerId e taxas vêm do Payment', () => {
    const r = projectPayment(
      {
        ...base,
        method: 'CREDIT',
        status: 'PAID',
        paidAt: new Date('2026-11-01T12:00:00Z'),
        acquirerId: 'aq-payment',
        feeAmount: 9,
        netAmount: 91,
      },
      [],
      NOW
    );
    expect(r.acquirerId).toBe('aq-payment');
    expect(r.feeAmount).toBe(9);
    expect(r.netAmount).toBe(91);
  });

  it('REFUNDED e canceledAt viram REFUNDED; PARTIAL pendente vira PENDING/OVERDUE', () => {
    expect(projectPayment({ ...base, status: 'REFUNDED' }, [], NOW).status).toBe('REFUNDED');
    expect(projectPayment({ ...base, canceledAt: new Date() }, [], NOW).status).toBe('REFUNDED');
    expect(
      projectPayment(
        { ...base, status: 'PARTIAL', createdAt: new Date('2026-11-25T12:00:00Z') },
        [],
        NOW
      ).status
    ).toBe('PENDING');
  });
});

describe('projectOtherIncome (F1.5)', () => {
  it('receita avulsa sempre PAID, expectedDate = receivedAt, clientName nulo', () => {
    const r = projectOtherIncome({
      id: 'oi1',
      description: 'Aluguel de cadeira',
      amount: 350,
      receivedAt: new Date('2026-11-15T00:00:00Z'),
      isReconciled: false,
    });
    expect(r.kind).toBe('OTHER_INCOME');
    expect(r.status).toBe('PAID');
    expect(r.clientName).toBeNull();
    expect(r.description).toBe('Aluguel de cadeira');
    expect(r.expectedDate.toISOString()).toBe('2026-11-15T00:00:00.000Z');
  });
});

describe('summarizeReceivables (F1.5)', () => {
  const baseRows: UnifiedReceivable[] = [
    { id: 'a', kind: 'PAYMENT', description: 'a', clientName: null, amount: 100, method: 'PIX', status: 'PAID', expectedDate: NOW, isReconciled: true, netAmount: 100, feeAmount: null, acquirerId: null },
    { id: 'b', kind: 'OTHER_INCOME', description: 'b', clientName: null, amount: 50, method: null, status: 'PAID', expectedDate: NOW, isReconciled: false, netAmount: null, feeAmount: null, acquirerId: null },
    { id: 'c', kind: 'PAYMENT', description: 'c', clientName: null, amount: 200, method: 'CREDIT', status: 'OVERDUE', expectedDate: NOW, isReconciled: false, netAmount: 194, feeAmount: 6, acquirerId: 'aq1' },
    { id: 'd', kind: 'PAYMENT', description: 'd', clientName: null, amount: 80, method: 'PIX', status: 'PENDING', expectedDate: NOW, isReconciled: false, netAmount: null, feeAmount: null, acquirerId: null },
  ];

  it('soma sobre a lista recebida: previsto, recebido, atraso e taxas de cartão', () => {
    expect(summarizeReceivables(baseRows)).toEqual({
      totalExpected: 430,
      totalReceived: 150,
      totalOverdue: 200,
      cardFees: 6,
    });
  });

  it('lista vazia zera todos os totais', () => {
    expect(summarizeReceivables([])).toEqual({
      totalExpected: 0,
      totalReceived: 0,
      totalOverdue: 0,
      cardFees: 0,
    });
  });

  it('acumula em centavos — 0.10 + 0.20 é exatamente 0.30', () => {
    const rows: UnifiedReceivable[] = [
      { ...baseRows[0], amount: 0.1 },
      { ...baseRows[1], amount: 0.2 },
    ];
    expect(summarizeReceivables(rows).totalExpected).toBe(0.3);
  });
});
