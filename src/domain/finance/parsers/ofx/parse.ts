/**
 * [F2.1] Parser OFX determinístico — spec §7.2 (FINANCEIRO_IMPLEMENTACAO.md:1220-1277).
 *
 * Tolera o que aparece em extrato brasileiro:
 *  - SGML sem tag de fechamento (`<TRNAMT>-10.00`) e XML bem formado;
 *  - vírgula decimal em alguns bancos (`-10,50`);
 *  - `DTPOSTED` com fuso (`20261118000000[-3:BRT]`) — usa só YYYYMMDD;
 *  - FITID ausente ou inútil (a estratégia fica por conta do dedupe);
 *  - descrição em `<MEMO>` e/ou `<NAME>` (concatenadas sem duplicar);
 *  - cartão de crédito (`<CCSTMTRS>`) no lugar de `<STMTRS>`.
 *
 * Confiança: alta no formato, média na uniformidade entre bancos — por isso a
 * revisão humana do lote é obrigatória (spec §7.4).
 */
import { composeDescription } from '../../text';

export interface OfxTx {
  /** FITID original (pode não existir). */
  fitid?: string;
  /** Data de posting em ISO (YYYY-MM-DD). */
  posted: string;
  /** Valor com sinal, em centavos (+ entrada, − saída). */
  cents: number;
  name?: string;
  memo?: string;
  type?: string;
  /** NAME + MEMO concatenados sem duplicar. */
  description: string;
}

export interface OfxResult {
  kind: 'BANK' | 'CARD';
  bankId?: string;
  accountId?: string;
  start?: string;
  end?: string;
  ledgerCents?: number;
  ledgerDate?: string;
  txs: OfxTx[];
}

/** Valor de uma tag: texto até o próximo `<` (SGML) ou fim da tag (XML). */
const tag = (block: string, name: string): string | undefined => {
  const match = new RegExp(`<${name}>\\s*([^<\\r\\n]*)`, 'i').exec(block);
  const value = match?.[1]?.trim();
  return value ? value : undefined;
};

/** `20261118000000[-3:BRT]` → `2026-11-18`. */
const toIsoDate = (raw: string): string => {
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  if (digits.length < 8) throw new Error(`Data OFX inválida: "${raw}"`);
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
};

/**
 * Valor OFX → centavos. Aceita ponto ou vírgula decimal (e separador de milhar
 * no outro estilo): "1500.00", "-10,50", "1.234,56", "1,234.56", "(99.90)".
 */
const parseOfxAmount = (raw: string): number => {
  let value = raw.trim().replace(/\s+/g, '').replace(/[^\d,.\-+()]/g, '');

  let negative = false;
  if (/^\(.*\)$/.test(value)) {
    negative = true;
    value = value.slice(1, -1);
  }
  if (/-$/.test(value)) {
    negative = true;
    value = value.slice(0, -1);
  }
  if (/^-/.test(value)) {
    negative = true;
    value = value.slice(1);
  }

  const lastComma = value.lastIndexOf(',');
  const lastDot = value.lastIndexOf('.');
  let intPart = value;
  let fracPart = '';

  if (lastComma >= 0 && lastDot >= 0) {
    // O separador decimal é o último; o outro é separador de milhar.
    if (lastComma > lastDot) {
      intPart = value.slice(0, lastComma).replace(/\./g, '');
      fracPart = value.slice(lastComma + 1);
    } else {
      intPart = value.slice(0, lastDot).replace(/,/g, '');
      fracPart = value.slice(lastDot + 1);
    }
  } else if (lastComma >= 0) {
    intPart = value.slice(0, lastComma).replace(/\./g, '');
    fracPart = value.slice(lastComma + 1);
  } else if (lastDot >= 0) {
    intPart = value.slice(0, lastDot).replace(/,/g, '');
    fracPart = value.slice(lastDot + 1);
  }

  const integer = intPart.replace(/\D/g, '') || '0';
  const fraction = (fracPart.replace(/\D/g, '') + '00').slice(0, 2);
  const cents = Number(integer) * 100 + Number(fraction);

  return negative ? -cents : cents;
};

const TX_BLOCKS = /<STMTTRN>([\s\S]*?)(?=<\/STMTTRN>|<STMTTRN>|<\/BANKTRANLIST>)/gi;
const LEDGER_BLOCK =
  /<LEDGERBAL>([\s\S]*?)(?=<\/LEDGERBAL>|<AVAILBAL>|<\/STMTRS>|<\/CCSTMTRS>|$)/i;

export function parseOfx(text: string): OfxResult {
  const ofxIndex = text.search(/<OFX>/i);
  const body = ofxIndex >= 0 ? text.slice(ofxIndex) : text;

  const kind: 'BANK' | 'CARD' = /<CCSTMTRS>/i.test(body) ? 'CARD' : 'BANK';

  const txs: OfxTx[] = [...body.matchAll(TX_BLOCKS)].map((match) => {
    const block = match[1];
    const name = tag(block, 'NAME');
    const memo = tag(block, 'MEMO');
    const postedRaw = tag(block, 'DTPOSTED');
    const amountRaw = tag(block, 'TRNAMT');

    if (!postedRaw) throw new Error('Transação OFX sem DTPOSTED');
    if (!amountRaw) throw new Error('Transação OFX sem TRNAMT');

    return {
      fitid: tag(block, 'FITID'),
      posted: toIsoDate(postedRaw),
      cents: parseOfxAmount(amountRaw),
      name,
      memo,
      type: tag(block, 'TRNTYPE'),
      description: composeDescription(name, memo),
    };
  });

  const ledger = LEDGER_BLOCK.exec(body)?.[1];
  const ledgerAmount = ledger ? tag(ledger, 'BALAMT') : undefined;
  const ledgerDateRaw = ledger ? tag(ledger, 'DTASOF') : undefined;
  const startRaw = tag(body, 'DTSTART');
  const endRaw = tag(body, 'DTEND');

  return {
    kind,
    bankId: tag(body, 'BANKID'),
    accountId: tag(body, 'ACCTID'),
    start: startRaw ? toIsoDate(startRaw) : undefined,
    end: endRaw ? toIsoDate(endRaw) : undefined,
    ledgerCents: ledgerAmount ? parseOfxAmount(ledgerAmount) : undefined,
    ledgerDate: ledgerDateRaw ? toIsoDate(ledgerDateRaw) : undefined,
    txs,
  };
}
