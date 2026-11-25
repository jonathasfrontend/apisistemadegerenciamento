/**
 * [F2.1] Inferência do método da transação bancária.
 * Spec §7.3 (FINANCEIRO_IMPLEMENTACAO.md:1283-1295).
 *
 * A ordem das regras é fixa (a primeira que casar vence) e a comparação é feita
 * sobre a descrição **normalizada de leve** (`normalizeText`): o ruído removido
 * na normalização completa apagaria keywords como "PIX" e "PAGTO TITULO".
 *
 * "Entrada" = valor positivo (amountCents > 0): depósito em espécie e
 * liquidação de cartão só fazem sentido em entrada.
 */
import { normalizeText } from './text';

export type InferredMethod =
  | 'PIX'
  | 'TED'
  | 'DOC'
  | 'BOLETO'
  | 'FEE'
  | 'INTEREST'
  | 'CASH_DEPOSIT'
  | 'CARD_SETTLEMENT'
  | 'OTHER';

export interface InferMethodOptions {
  /** Valor com sinal, em centavos. Positivo = entrada. */
  amountCents?: number;
  /** `Acquirer.bankKeywords` da empresa (case/acento-insensível). */
  acquirerKeywords?: string[];
}

/** Regras da spec, na ordem original. */
const RULES: ReadonlyArray<{ method: InferredMethod; pattern: RegExp }> = [
  { method: 'PIX', pattern: /\bPIX\b/ },
  { method: 'TED', pattern: /\bTED\b/ },
  { method: 'DOC', pattern: /\bDOC\b/ },
  { method: 'BOLETO', pattern: /BOLETO|PAGTO TITULO|COBRANCA|\bTIT\b/ },
  { method: 'FEE', pattern: /\bTARIFA\b|\bTAR\b|PACOTE SERV|\bIOF\b|\bANUIDADE\b/ },
  { method: 'INTEREST', pattern: /\bJUROS\b|\bENCARGO\b|\bMULTA\b/ },
];

const CASH_DEPOSIT_PATTERN = /\bDEPOSITO\b|\bDEP\.? DINHEIRO\b|\bDEP ESPECIE\b/;

export function inferMethod(description: string, opts: InferMethodOptions = {}): InferredMethod {
  const text = normalizeText(description);

  for (const rule of RULES) {
    if (rule.pattern.test(text)) return rule.method;
  }

  const isIncome = (opts.amountCents ?? 0) > 0;

  if (isIncome && CASH_DEPOSIT_PATTERN.test(text)) return 'CASH_DEPOSIT';

  if (isIncome) {
    for (const keyword of opts.acquirerKeywords ?? []) {
      const normalized = normalizeText(keyword);
      if (normalized && text.includes(normalized)) return 'CARD_SETTLEMENT';
    }
  }

  return 'OTHER';
}
