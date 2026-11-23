/**
 * [F1.2] Regras de dinheiro — spec §2.4.
 * Valores inteiros em centavos; arredondamento HALF_UP; nenhum float na fronteira.
 */
import { Prisma } from '@prisma/client';
import { fromCents, parseBRL, toApi, toCents } from '../../../src/domain/finance/money';

describe('finance money (F1.2)', () => {
  const formats: Array<[string, number]> = [
    ['1.234,56', 123456],
    ['-1.234,56', -123456],
    ['1.234,56-', -123456],
    ['1.234,56 D', -123456],
    ['1.234,56 DB', -123456],
    ['(1.234,56)', -123456],
    ['R$ 1.234,56', 123456],
    ['1234,56', 123456],
    ['1.234', 123400],
    ['0,99', 99],
    ['1.234,56 CR', 123456],
    ['1.234,56 C', 123456],
  ];

  it.each(formats)('parseBRL(%p) = %p', (raw, expected) => {
    expect(parseBRL(raw)).toBe(expected);
  });

  it('parseBRL rejeita valor inválido', () => {
    expect(() => parseBRL('doze reais')).toThrow(/Valor inválido/);
  });

  it('toCents usa ROUND_HALF_UP (não banker rounding)', () => {
    expect(toCents(1.005)).toBe(101);
    expect(toCents(new Prisma.Decimal('2.675'))).toBe(268);
    expect(toCents('-0.005')).toBe(-1);
  });

  it('fromCents/toApi preservam a precisão de 2 casas', () => {
    expect(fromCents(123456).toString()).toBe('1234.56');
    expect(toApi(new Prisma.Decimal('1234.56'))).toBe(1234.56);
  });
});
