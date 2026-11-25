/**
 * [F2.1] Dedupe de linhas importadas — spec §7.3 (FINANCEIRO_IMPLEMENTACAO.md:1297-1313).
 *
 * Estratégia por arquivo:
 *  - `F:<FITID>` quando o FITID é confiável: presente em **todas** as linhas e
 *    único no arquivo. FITID vazio, ausente ou "0" é tratado como não
 *    confiável (Review Focus #2 do plano F2 — FITID "0" é comum em extratos).
 *  - `H:<sha256>` quando não dá para confiar no FITID:
 *    hash de `postedAt|cents|descrição normalizada|n`, onde `n` é a ocorrência
 *    da tripla dentro do próprio arquivo (duas compras iguais no mesmo dia são
 *    duas linhas, não uma).
 */
import { createHash } from 'node:crypto';
import { normalizeDescription } from './text';

export interface DedupeRow {
  postedAt: string;
  cents: number;
  description: string;
  externalId?: string | null;
}

const isReliableFitid = (externalId?: string | null): boolean => {
  if (externalId === null || externalId === undefined) return false;
  const value = String(externalId).trim();
  return value.length > 0 && value !== '0';
};

export function computeDedupeKeys(rows: DedupeRow[]): string[] {
  if (rows.length === 0) return [];

  const fitids = rows.map((row) => (row.externalId ?? '').trim());
  const fitidReliable =
    fitids.every(isReliableFitid) && new Set(fitids).size === fitids.length;

  const seen = new Map<string, number>();

  return rows.map((row, index) => {
    if (fitidReliable) return `F:${fitids[index]}`;

    const base = `${row.postedAt}|${row.cents}|${normalizeDescription(row.description)}`;
    const occurrence = (seen.get(base) ?? 0) + 1;
    seen.set(base, occurrence);

    const digest = createHash('sha256').update(`${base}|${occurrence}`).digest('hex');
    return `H:${digest}`;
  });
}
