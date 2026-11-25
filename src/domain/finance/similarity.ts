/**
 * [F2.2] Similaridade de nomes — spec §7.6.2 (FINANCEIRO_IMPLEMENTACAO.md:1383-1389).
 *
 * Interseção de tokens / menor conjunto. Tokens com menos de 3 letras e
 * stopwords (DE, DA, DO, LTDA, ME…) são ignorados: sem isso "LTDA" sozinho
 * faria qualquer nome de empresa parecer 100% parecido.
 *
 * Reaproveitado na F2.2 (detecção de `possibleDuplicate`) e na F2.5/F2.6
 * (pontuação de candidatos na conciliação).
 *
 * A normalização (maiúsculas, sem acentos, pontuação neutra) é a mesma da
 * inferência de método (`normalizeText`).
 */
import { normalizeText } from './text';

const STOPWORDS = new Set([
  'DE',
  'DA',
  'DO',
  'DAS',
  'DOS',
  'E',
  'LTDA',
  'ME',
  'EPP',
  'SA',
]);

const tokens = (value?: string): Set<string> => {
  if (!value) return new Set();
  return new Set(
    normalizeText(value)
      .split(' ')
      .filter((token) => token.length >= 3 && !STOPWORDS.has(token))
  );
};

/** Similaridade 0..1 entre dois nomes/descrições. */
export function nameSimilarity(a?: string, b?: string): number {
  const A = tokens(a);
  const B = tokens(b);
  if (!A.size || !B.size) return 0;

  let hits = 0;
  for (const token of A) {
    if (B.has(token)) hits += 1;
  }
  return hits / Math.min(A.size, B.size);
}
