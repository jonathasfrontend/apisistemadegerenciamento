import { z } from 'zod';

/**
 * [F2.2] Schemas de importação — spec §9.2 (FINANCEIRO_IMPLEMENTACAO.md:1761-1767).
 *
 * Campos de multipart chegam como string: booleanos são normalizados aqui.
 * `companyId` NÃO faz parte do schema — a empresa vem do `req.user`
 * (recarregado do banco), nunca do body.
 */

const booleanField = z.enum(['true', 'false', '1', '0']).optional();

export const uploadImportSchema = z.object({
  body: z.object({
    bankAccountId: z.string().trim().min(1, 'Conta bancária é obrigatória').max(60),
    kind: z.enum(['BANK_STATEMENT', 'CREDIT_CARD_INVOICE']).optional(),
    invertSigns: booleanField,
    force: booleanField,
    password: z.string().max(120).optional(),
  }),
});

export const listImportsSchema = z.object({
  body: z.object({}).optional(),
  query: z.object({
    page: z.string().optional(),
    limit: z.string().optional(),
    status: z
      .enum([
        'UPLOADED',
        'PROCESSING',
        'READY',
        'NEEDS_REVIEW',
        'CONFIRMED',
        'FAILED',
        'DISCARDED',
      ])
      .optional(),
    sort: z.string().optional(),
  }),
});

export const importIdSchema = z.object({
  body: z.object({}).optional(),
  params: z.object({
    id: z.string().trim().min(1, 'Id do lote é obrigatório').max(60),
  }),
});

export const listImportRowsSchema = z.object({
  body: z.object({}).optional(),
  query: z.object({
    page: z.string().optional(),
    limit: z.string().optional(),
  }),
  params: z.object({
    id: z.string().trim().min(1, 'Id do lote é obrigatório').max(60),
  }),
});

/** [F2.3] Edição de linha em staging (spec §7.2). */
export const patchImportRowSchema = z.object({
  body: z
    .object({
      description: z.string().trim().min(1, 'Descrição não pode ser vazia').max(500).optional(),
      amount: z.number().finite().optional(),
      postedAt: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data deve estar no formato AAAA-MM-DD')
        .optional(),
      isIgnored: z.boolean().optional(),
    })
    .refine((body) => Object.keys(body).length > 0, {
      message: 'Informe ao menos um campo para editar',
    }),
  params: z.object({
    id: z.string().trim().min(1, 'Id do lote é obrigatório').max(60),
    rowId: z.string().trim().min(1, 'Id da linha é obrigatório').max(60),
  }),
});

/** [F2.3] Confirmação do lote — ack obrigatório quando o saldo diverge. */
export const confirmImportSchema = z.object({
  body: z.object({
    acknowledgeMismatch: z.boolean().optional(),
  }),
  params: z.object({
    id: z.string().trim().min(1, 'Id do lote é obrigatório').max(60),
  }),
});
