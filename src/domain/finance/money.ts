/**
 * [F1.2] Regras de dinheiro — spec §2.4 (FINANCEIRO_IMPLEMENTACAO.md:166-205).
 *
 * Fronteira única: Todo valor monetário entra em centavos inteiros e sai como
 * Decimal para o banco. Nenhum float participa de cálculo de caixa.
 */
import { Prisma } from '@prisma/client';

export type Cents = number;

export const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

/** Arredondamento HALF_UP (não banker's rounding) na fronteira Decimal → centavos. */
export const toCents = (v: Prisma.Decimal.Value): Cents =>
  D(v).mul(100).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).toNumber();

/** Centavos → Decimal para gravar em coluna Decimal(14,2). */
export const fromCents = (c: Cents) => D(c).div(100);

/** Decimal → number para resposta JSON (2 casas). */
export const toApi = (v: Prisma.Decimal.Value) => D(v).toNumber();

/** Formatos pt-BR aceitos: "1.234,56" | "-1.234,56" | "1.234,56-" | "D/DB" | "(…)" | "R$ …". */
export function parseBRL(raw: string): Cents {
  let s = raw.trim().replace(/\s+/g, '').replace(/^R\$/i, '');
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  if (/^[-−]/.test(s)) {
    neg = true;
    s = s.slice(1);
  }
  if (/-$/.test(s)) {
    neg = true;
    s = s.slice(0, -1);
  }
  const suffix = /(DB|D|CR|C)$/i.exec(s)?.[1]?.toUpperCase();
  if (suffix) {
    s = s.slice(0, -suffix.length);
    if (suffix.startsWith('D')) neg = true;
  }
  if (!/^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+(,\d{1,2})?$/.test(s)) {
    throw new Error(`Valor inválido: "${raw}"`);
  }
  const [int, frac = ''] = s.replace(/\./g, '').split(',');
  const cents = Number(int) * 100 + Number((frac + '00').slice(0, 2));
  return neg ? -cents : cents;
}
