/**
 * [F1.2] Fechamento de caixa puro — spec:1002-1026.
 * Exemplo normativo: abertura 200 + vendas 120/80 − despesa 25 − sangria 300
 * = esperado 75; contado 70 → diferença −5 (falta).
 */
import { computeClosing, summarizeByMethod } from '../../../src/domain/finance/cash/closing';

const movements = [
  { direction: 'IN' as const, cents: 12000, voided: false },
  { direction: 'IN' as const, cents: 8000, voided: false },
  { direction: 'OUT' as const, cents: 2500, voided: false },
  { direction: 'OUT' as const, cents: 30000, voided: false },
];

describe('computeClosing (F1.2)', () => {
  it('exemplo da spec: expected=7500, difference=-500', () => {
    const result = computeClosing(20000, movements, 7000);
    expect(result).toMatchObject({
      totalIn: 20000,
      totalOut: 32500,
      expected: 7500,
      difference: -500,
    });
  });

  it('movimento anulado não entra em totalIn/totalOut nem no esperado', () => {
    const withVoid = [...movements, { direction: 'IN' as const, cents: 99999, voided: true }];
    expect(computeClosing(20000, withVoid, 7000)).toEqual(computeClosing(20000, movements, 7000));
  });

  it('diferença positiva = sobra', () => {
    expect(computeClosing(0, [], 500).difference).toBe(500);
  });
});

describe('summarizeByMethod (F1.2 / C7)', () => {
  it('soma só pagamentos confirmados, agrupados por método, em centavos', () => {
    const summary = summarizeByMethod([
      { method: 'PIX', amount: 100, status: 'PAID' },
      { method: 'PIX', amount: 50, status: 'PENDING' },
      { method: 'CREDIT_CARD', amount: 200, status: 'PAID' },
      { method: 'CASH', amount: 30, status: 'PAID' },
    ]);
    expect(summary).toEqual({ PIX: 10000, CREDIT_CARD: 20000, CASH: 3000 });
  });
});
