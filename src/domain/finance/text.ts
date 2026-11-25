/**
 * [F2.1] Normalização de texto — spec §7.3 (FINANCEIRO_IMPLEMENTACAO.md:1281).
 *
 * Dois níveis, porque os usos são diferentes:
 *
 *  - `normalizeText` (leve): maiúsculas → sem acentos → pontuação vira espaço →
 *    colapsa espaços. **Mantém** os tokens de método (PIX, TIT, PAGTO, TAR…).
 *    É o nível usado na inferência de método.
 *
 *  - `normalizeDescription` (completo): o nível leve **+ remoção de ruído**
 *    (PIX, RECEBIDO, ENVIADO, TRANSF, TRANSFERENCIA, COMPRA, DEB, CRED, PAGTO),
 *    datas e sequências com mais de 6 dígitos. É usado **apenas para
 *    comparação** (dedupe, similaridade, busca). O texto original é preservado
 *    pelo chamador — nenhuma função altera a string recebida.
 *
 * Colisão conhecida da spec: "PIX" e "PAGTO" estão na lista de ruído *e* são
 * keywords de método. Por isso a inferência de método usa `normalizeText`.
 */

/** Tokens de ruído removidos na comparação (spec §7.3). */
const NOISE_TOKENS = [
  'PIX',
  'RECEBIDO',
  'ENVIADO',
  'TRANSF',
  'TRANSFERENCIA',
  'COMPRA',
  'DEB',
  'CRED',
  'PAGTO',
] as const;

/** Datas em dd/mm/aaaa, aaaa-mm-dd (e variações com ponto/ hífen). */
const DATE_PATTERNS: RegExp[] = [
  /\b\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}\b/g,
  /\b\d{4}[/\-.]\d{1,2}[/\-.]\d{1,2}\b/g,
];

const removeAccents = (value: string): string =>
  value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

const punctuationToSpace = (value: string): string => value.replace(/[^A-Z0-9\s]/g, ' ');

const collapse = (value: string): string => value.replace(/\s+/g, ' ').trim();

/** Normalização leve: maiúsculas, sem acentos, pontuação neutra. */
export function normalizeText(raw: string): string {
  if (!raw) return '';
  return collapse(punctuationToSpace(removeAccents(raw.toUpperCase())));
}

/**
 * Normalização completa para comparação: nível leve + ruído + datas +Digits.
 * Datas e sequências longas são removidas **antes** da troca de pontuação,
 * senão "18/11/2026" viraria "18 11 2026" e deixaria de ser data.
 */
export function normalizeDescription(raw: string): string {
  if (!raw) return '';

  let value = removeAccents(raw.toUpperCase());

  for (const pattern of DATE_PATTERNS) {
    value = value.replace(pattern, ' ');
  }

  // Sequências com mais de 6 dígitos (identificadores, agências, NSU).
  value = value.replace(/\d{7,}/g, ' ');

  for (const token of NOISE_TOKENS) {
    value = value.replace(new RegExp(`\\b${token}\\b`, 'g'), ' ');
  }

  return collapse(punctuationToSpace(value));
}

/**
 * Concatena NAME e MEMO sem duplicar (spec §7.2 item 6).
 * Se um contém o outro, vence o mais completo; senão, "NAME MEMO".
 */
export function composeDescription(name?: string, memo?: string): string {
  const n = (name ?? '').trim();
  const m = (memo ?? '').trim();

  if (!n) return m;
  if (!m) return n;

  const nl = n.toLowerCase();
  const ml = m.toLowerCase();

  if (nl.includes(ml)) return n;
  if (ml.includes(nl)) return m;

  return `${n} ${m}`;
}
