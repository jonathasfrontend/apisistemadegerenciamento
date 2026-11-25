/**
 * [F2.5] Scoring 1:1 — spec §7.6.2 (FINANCEIRO_IMPLEMENTACAO.md:1355-1392).
 *
 * Módulo puro. Nenhuma função toca prisma, req ou relógio: a data vem do
 * chamador (postedAt da transação e a data do candidato), o que mantém o
 * cálculo determinístico e testável sem banco.
 */
import { normalizeText } from '../text';

export interface ScoreTx {
  /** Valor com sinal; o score usa o módulo. */
  cents: number;
  postedAt: Date | string;
  inferredMethod: string;
  normalizedDescription: string;
  bankAccountId?: string | null;
}

export interface ScoreCandidate {
  id: string;
  /**Valor ainda livre no alvo, em centavos (I5). */
  remainingCents: number;
  date: Date | string;
  method?: string | null;
  counterpartyName?: string | null;
  bankAccountId?: string | null;
}

export interface ScoreConfig {
  windowDays: number;
}

const DATE_PTS = [25, 20, 12, 6] as const;
const STOPWORDS = new Set(['DE', 'DA', 'DO', 'LTDA', 'ME']);

const day = (value: Date | string): number => {
  const d = typeof value === 'string' ? new Date(`${value.slice(0, 10)}T00:00:00.000Z`) : value;
  return Math.floor(d.getTime() / 86_400_000);
};

export const daysBetween = (a: Date | string, b: Date | string): number =>
  Math.abs(day(a) - day(b));

const tokens = (raw?: string | null): Set<string> => {
  if (!raw) return new Set();
  return new Set(
    normalizeText(raw)
      .split(/\s+/)
      .filter((t) => t.length >= 3 && !STOPWORDS.has(t))
  );
};

/** Interseção de tokens / menor conjunto. Ignora tokens < 3 letras e stopwords. */
export function nameSimilarity(a?: string | null, b?: string | null): number {
  const A = tokens(a);
  const B = tokens(b);
  if (!A.size || !B.size) return 0;
  let hit = 0;
  for (const t of A) if (B.has(t)) hit += 1;
  return hit / Math.min(A.size, B.size);
}

/**
 * Aliases aceitos para o método inferido do extrato. `PaymentMethod` do
 * sistema não tem TED/DOC/BOLETO, então o candidato pode trazer um rótulo
 * textual (ex.: "BOLETO" inferido da descrição da despesa) — os aliases
 * cobrem essa tradução sem inventar enum novo.
 */
const ALIASES: Record<string, string[]> = {
  PIX: ['PIX'],
  TED: ['TED', 'TRANSFERENCIA'],
  DOC: ['DOC', 'TRANSFERENCIA'],
  BOLETO: ['BOLETO', 'TITULO'],
  CARD_SETTLEMENT: ['CARD_SETTLEMENT', 'CREDIT', 'CARD'],
  FEE: ['FEE', 'TARIFA'],
  INTEREST: ['INTEREST', 'JUROS'],
  CASH_DEPOSIT: ['CASH', 'CASH_DEPOSIT'],
  OTHER: [],
};

/** Pares claramente contraditórios: taxa/juros não são pagamento de cliente. */
const INCOMPATIBLE: Record<string, string[]> = {
  FEE: ['PIX', 'CREDIT', 'DEBIT', 'LINK', 'WALLET', 'CARD_SETTLEMENT'],
  INTEREST: ['PIX', 'CREDIT', 'DEBIT', 'LINK', 'WALLET', 'CARD_SETTLEMENT'],
  CARD_SETTLEMENT: ['PIX', 'FEE'],
  CASH_DEPOSIT: ['PIX', 'BOLETO'],
};

/** +15 compatível · 0 indefinido · −20 incompatível claro. */
export function methodScore(txMethod: string | null | undefined, candMethod: string | null | undefined): number {
  if (!txMethod || !candMethod) return 0;
  const t = txMethod.toUpperCase();
  const c = candMethod.toUpperCase();
  if ((ALIASES[t] ?? []).includes(c)) return 15;
  if ((INCOMPATIBLE[t] ?? []).includes(c) || (INCOMPATIBLE[c] ?? []).includes(t)) return -20;
  return 0;
}

/** 40 valor + data (25/20/12/6/2) ± método + nome (0–20) + conta (+5), clamp 0–100. */
export function scoreCandidate(tx: ScoreTx, c: ScoreCandidate, cfg: ScoreConfig): number {
  if (c.remainingCents !== Math.abs(tx.cents)) return 0;
  const dd = daysBetween(tx.postedAt, c.date);
  if (dd > cfg.windowDays) return 0;

  let score = 40 + (DATE_PTS[dd] ?? 2);
  score += methodScore(tx.inferredMethod, c.method);
  score += Math.round(20 * nameSimilarity(tx.normalizedDescription, c.counterpartyName));
  if (c.bankAccountId && c.bankAccountId === tx.bankAccountId) score += 5;
  return Math.max(0, Math.min(100, score));
}
