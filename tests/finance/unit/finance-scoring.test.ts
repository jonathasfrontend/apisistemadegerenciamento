/**
 * [F2.5] Scoring 1:1 — spec §7.6.2 (FINANCEIRO_IMPLEMENTACAO.md:1355-1392).
 *
 * 40 valor exato + data (25/20/12/6/2) ± método (+15/0/−20) + nome (0–20)
 * + mesma conta (+5), com clamp 0–100. Pré-condição: valor exato em centavos.
 */
import {
  nameSimilarity,
  scoreCandidate,
  type ScoreCandidate,
  type ScoreTx,
} from '../../../src/domain/finance/reconciliation/scoring';

const tx = (over: Partial<ScoreTx> = {}): ScoreTx => ({
  cents: -12000,
  postedAt: '2026-11-18',
  inferredMethod: 'PIX',
  normalizedDescription: 'PIX RECEBIDO ANA SILVA SANTOS',
  bankAccountId: 'conta-a',
  ...over,
});

const cand = (over: Partial<ScoreCandidate> = {}): ScoreCandidate => ({
  id: 'payment-1',
  remainingCents: 12000,
  date: '2026-11-18',
  method: 'PIX',
  counterpartyName: 'Ana Silva',
  bankAccountId: null,
  ...over,
});

const cfg = { windowDays: 3 };

describe('finance scoring (F2.5)', () => {
  it('dá 100 no exemplo da spec (PIX, mesmo dia, nome bate)', () => {
    expect(scoreCandidate(tx(), cand(), cfg)).toBe(100);
  });

  it('dá 80 quando o nome não bate (Bia Costa)', () => {
    expect(scoreCandidate(tx(), cand({ counterpartyName: 'Bia Costa' }), cfg)).toBe(80);
  });

  it('dá 0 quando o valor não é exato', () => {
    expect(scoreCandidate(tx(), cand({ remainingCents: 11999 }), cfg)).toBe(0);
  });

  it('pontua data 25/20/12/6/2 conforme a distância em dias', () => {
    const base = cand({ counterpartyName: null, method: null });
    const wide = { windowDays: 5 };
    expect(scoreCandidate(tx(), cand({ ...base, date: '2026-11-18' }), cfg)).toBe(65);
    expect(scoreCandidate(tx(), cand({ ...base, date: '2026-11-19' }), cfg)).toBe(60);
    expect(scoreCandidate(tx(), cand({ ...base, date: '2026-11-20' }), cfg)).toBe(52);
    expect(scoreCandidate(tx(), cand({ ...base, date: '2026-11-21' }), cfg)).toBe(46);
    expect(scoreCandidate(tx(), cand({ ...base, date: '2026-11-22' }), wide)).toBe(42);
    expect(scoreCandidate(tx(), cand({ ...base, date: '2026-11-23' }), wide)).toBe(42);
  });

  it('rejeita data fora da janela mesmo com valor exato', () => {
    expect(scoreCandidate(tx(), cand({ date: '2026-11-23' }), cfg)).toBe(0);
  });

  it('penaliza método incompatível claro (FEE x PIX) em 20', () => {
    expect(scoreCandidate(tx({ inferredMethod: 'FEE' }), cand(), cfg)).toBe(65);
  });

  it('dá +5 quando a conta do candidato é a mesma', () => {
    expect(scoreCandidate(tx(), cand({ bankAccountId: 'conta-a', counterpartyName: 'Bia Costa' }), cfg)).toBe(85);
    expect(scoreCandidate(tx(), cand({ bankAccountId: 'conta-b', counterpartyName: 'Bia Costa' }), cfg)).toBe(80);
  });

  it('limita o score a 100 mesmo somando +5', () => {
    expect(scoreCandidate(tx(), cand({ bankAccountId: 'conta-a' }), cfg)).toBeLessThanOrEqual(100);
  });

  describe('nameSimilarity', () => {
    it('é 1 quando todos os tokens do menor conjunto aparecem', () => {
      expect(nameSimilarity('ANA SILVA SANTOS', 'Ana Silva')).toBe(1);
    });

    it('ignora stopwords e tokens com menos de 3 letras', () => {
      expect(nameSimilarity('DE DA DO LTDA ME A O', 'LTDA ME')).toBe(0);
      expect(nameSimilarity('Ana Silva Ltda ME', 'SILVA ANA')).toBe(1);
    });

    it('interseção parcial usa o menor conjunto como denominador', () => {
      expect(nameSimilarity('ANA SILVA SANTOS', 'SILVA COSTA')).toBe(0.5);
    });

    it('é 0 quando falta um dos lados', () => {
      expect(nameSimilarity(undefined, 'Ana')).toBe(0);
      expect(nameSimilarity('Ana', null)).toBe(0);
    });
  });
});
