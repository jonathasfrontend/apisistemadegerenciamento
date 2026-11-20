export const MAX_LIMIT = 100;
export const DEFAULT_LIMIT = 20;
export const MAX_PAGE = 1000;

/**
 * Normaliza `limit` de query string.
 *
 * - numérico (inclusive 0 ou negativo) → clamp 1..100
 * - lixo ("abc", "12abc") → fallback (nunca "sem limite": devolveria a tabela inteira)
 * - ausente/vazio → fallback
 *
 * `Number` (não `parseInt`) de propósito: `parseInt('12abc')` = 12 e
 * `parseInt('1e2')` = 1 — ambos silenciosamente errados.
 */
export function parseLimit(raw: unknown, fallback: number = DEFAULT_LIMIT): number {
  if (raw === undefined || raw === null) return fallback;

  const text = String(raw).trim();
  if (text === '') return fallback;

  const parsed = Number(text);
  if (!Number.isInteger(parsed)) return fallback;

  return Math.min(Math.max(parsed, 1), MAX_LIMIT);
}

/**
 * Normaliza `page` de query string: 1..MAX_PAGE.
 * Teto existe porque `skip` enorme pressiona o banco sem ganho real.
 */
export function parsePage(raw: unknown, fallback = 1): number {
  if (raw === undefined || raw === null) return fallback;

  const text = String(raw).trim();
  if (text === '') return fallback;

  const parsed = Number(text);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;

  return Math.min(parsed, MAX_PAGE);
}
