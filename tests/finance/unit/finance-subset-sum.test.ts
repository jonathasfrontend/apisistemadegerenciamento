/**
 * [F2.5] Subset sum para cartão 1:N — spec §7.6.3 (FINANCEIRO_IMPLEMENTACAO.md:1394-1422).
 * findSubset(cands, target, tol, maxNodes=200_000) + tolerância
 * max(1, round(T × cardTolerancePct / 100)) centavos.
 */
import { cardToleranceCents, findSubset } from '../../../src/domain/finance/reconciliation/subset-sum';

const c = (id: string, cents: number) => ({ id, cents });

describe('finance subset sum (F2.5)', () => {
  it('acha combinação exata', () => {
    expect(findSubset([c('a', 6000), c('b', 4000), c('c', 3000)], 10000, 0)).toEqual(['a', 'b']);
  });

  it('acha combinação dentro da tolerância', () => {
    expect(findSubset([c('a', 6000), c('b', 3950), c('c', 1000)], 10000, 100)).toEqual(['a', 'b']);
  });

  it('devolve null quando não há solução', () => {
    expect(findSubset([c('a', 6000), c('b', 3000)], 10000, 0)).toBeNull();
  });

  it('devolve null quando todos os candidatos somam menos do que o alvo', () => {
    expect(findSubset([c('a', 100), c('b', 200)], 1000, 10)).toBeNull();
  });

  it('respeita o limite de nós', () => {
    const many = Array.from({ length: 40 }, (_, i) => c(`c${i}`, 100 + i));
    expect(findSubset(many, 999999, 0, 10)).toBeNull();
  });

  it('não escolhe subconjunto vazio', () => {
    expect(findSubset([c('a', 100)], 0, 0)).toBeNull();
  });

  describe('cardToleranceCents', () => {
    it('aplica o percentual sobre centavos', () => {
      expect(cardToleranceCents(12000, 1.5)).toBe(180);
    });

    it('tem piso de 1 centavo', () => {
      expect(cardToleranceCents(10, 1.5)).toBe(1);
      expect(cardToleranceCents(0, 1.5)).toBe(1);
    });

    it('arredonda HALF_UP', () => {
      expect(cardToleranceCents(100, 1.5)).toBe(2);
    });
  });
});
