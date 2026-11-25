/**
 * [F2.2] Staging do lote de importação — spec §7.3/§7.4
 * (FINANCEIRO_IMPLEMENTACAO.md:1297-1328).
 *
 * Funções puras: recebem as transações já lidas pelo parser e as transações
 * que já existem na conta, devolvem as linhas de staging + a verificação de
 * saldo. Nenhuma chamada de banco ou de storage aqui — quem orquestra é o
 * job `finance-import`.
 */
import { computeDedupeKeys } from '../dedupe';
import { inferMethod, InferredMethod } from '../method-inference';
import { nameSimilarity } from '../similarity';
import { normalizeDescription } from '../text';

export interface ProcessTx {
  /** Data de posting em ISO (YYYY-MM-DD). */
  posted: string;
  /** Valor com sinal, em centavos (+ entrada, − saída). */
  cents: number;
  description: string;
  memo?: string;
  /** FITID original do OFX (pode não existir). */
  fitid?: string;
  type?: string;
}

export interface ExistingTransaction {
  dedupeKey: string;
  /** Data em ISO (YYYY-MM-DD). */
  postedAt: string;
  cents: number;
  normalizedDescription: string;
}

export interface BuiltRow {
  rowIndex: number;
  postedAt: string;
  cents: number;
  description: string;
  memo?: string;
  externalId?: string;
  dedupeKey: string;
  normalizedDescription: string;
  inferredMethod: InferredMethod;
  isDuplicate: boolean;
  possibleDuplicate: boolean;
  warnings: string[];
}

export type BalanceCheck = 'OK' | 'MISMATCH' | 'UNAVAILABLE';

export interface BuildRowsResult {
  rows: BuiltRow[];
  /** Avisos de nível lote. */
  warnings: string[];
  /** Σ das linhas, em centavos. */
  rowsCents: number;
}

/** Limiar de similaridade para `possibleDuplicate` (spec §7.4). */
export const POSSIBLE_DUPLICATE_SIMILARITY = 0.8;

export function buildImportRows(params: {
  txs: ProcessTx[];
  /** `Acquirer.bankKeywords` da empresa (para inferir CARD_SETTLEMENT). */
  acquirerKeywords: string[];
  /** Transações já existentes na conta. */
  existing: ExistingTransaction[];
  /** Inverte os sinais (extrato com débito positivo). */
  invertSigns?: boolean;
}): BuildRowsResult {
  const { txs, acquirerKeywords, existing, invertSigns = false } = params;

  const prepared = txs.map((tx) => ({
    ...tx,
    cents: invertSigns ? -tx.cents : tx.cents,
  }));

  const dedupeKeys = computeDedupeKeys(
    prepared.map((tx) => ({
      postedAt: tx.posted,
      cents: tx.cents,
      description: tx.description,
      externalId: tx.fitid ?? null,
    }))
  );

  const existingKeys = new Set(existing.map((tx) => tx.dedupeKey));
  const batchWarnings: string[] = [];

  const rows: BuiltRow[] = prepared.map((tx, index) => {
    const dedupeKey = dedupeKeys[index];
    const normalizedDescription = normalizeDescription(tx.description);
    const inferredMethod = inferMethod(tx.description, {
      amountCents: tx.cents,
      acquirerKeywords,
    });

    const isDuplicate = existingKeys.has(dedupeKey);

    const possibleDuplicate =
      !isDuplicate &&
      existing.some(
        (candidate) =>
          candidate.dedupeKey !== dedupeKey &&
          candidate.postedAt === tx.posted &&
          candidate.cents === tx.cents &&
          nameSimilarity(candidate.normalizedDescription, normalizedDescription) >=
            POSSIBLE_DUPLICATE_SIMILARITY
      );

    const warnings: string[] = [];
    if (possibleDuplicate) warnings.push('POSSIBLE_DUPLICATE');

    return {
      rowIndex: index,
      postedAt: tx.posted,
      cents: tx.cents,
      description: tx.description,
      memo: tx.memo,
      externalId: tx.fitid,
      dedupeKey,
      normalizedDescription,
      inferredMethod,
      isDuplicate,
      possibleDuplicate,
      warnings,
    };
  });

  if (rows.some((row) => row.possibleDuplicate)) {
    batchWarnings.push('POSSIBLE_DUPLICATES');
  }

  return {
    rows,
    warnings: batchWarnings,
    rowsCents: rows.reduce((sum, row) => sum + row.cents, 0),
  };
}

/**
 * Verificação de saldo (spec §7.4, "Verificação de saldo").
 *
 * `computedEnd = saldo anterior do arquivo (se houver) + Σ linhas`
 * ou `saldo da conta no sistema até (periodStart − 1) + Σ linhas`.
 */
export function computeBalanceCheck(params: {
  /** Saldo da conta antes do período (em centavos). */
  baseCents: number;
  /** Σ das linhas do lote (em centavos). */
  rowsCents: number;
  /** Saldo final declarado no arquivo (em centavos). */
  statementEndCents?: number | null;
}): { computedEndCents: number; balanceCheck: BalanceCheck } {
  const computedEndCents = params.baseCents + params.rowsCents;

  if (params.statementEndCents === null || params.statementEndCents === undefined) {
    return { computedEndCents, balanceCheck: 'UNAVAILABLE' };
  }

  return {
    computedEndCents,
    balanceCheck: computedEndCents === params.statementEndCents ? 'OK' : 'MISMATCH',
  };
}
