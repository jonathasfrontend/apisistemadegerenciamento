import { z } from 'zod';
import { normalizeKeyword } from '../shared';

const keyword = z
  .string()
  .trim()
  .min(1, 'Palavra-chave não pode ser vazia')
  .max(100)
  .transform(normalizeKeyword);

/** spec:557/1071 — taxas são PORCENTAGEM (ex.: 1.9900 = 1,99%), não fração. */
const rate = z
  .number({ invalid_type_error: 'Taxa inválida' })
  .min(0, 'Taxa não pode ser negativa')
  // Decimal(6,4) no banco comporta até 99.9999; 100 estouraria o Postgres.
  .max(99.9999, 'Taxa deve ser porcentagem (0 a 99.9999)');

export const listAcquirersSchema = z.object({
  body: z.object({}).optional(),
  query: z.object({
    page: z.string().optional(),
    limit: z.string().optional(),
    isActive: z.enum(['true', 'false', '1', '0']).optional(),
    sort: z.string().optional(),
  }),
});

export const createAcquirerSchema = z.object({
  body: z.object({
    name: z.string().trim().min(1, 'Nome é obrigatório').max(120),
    bankKeywords: z.array(keyword).default([]),
    debitRate: z
      .number({ invalid_type_error: 'Taxa de débito é obrigatória' })
      .min(0)
      .max(99.9999),
    creditRate: z
      .number({ invalid_type_error: 'Taxa de crédito é obrigatória' })
      .min(0)
      .max(99.9999),
    creditInstallmentRate: rate.nullable().optional(),
    installmentRates: z.record(rate).nullable().optional(),
    settlementDaysDebit: z.number().int().min(0).max(365).optional(),
    settlementDaysCredit: z.number().int().min(0).max(365).optional(),
    anticipates: z.boolean().optional(),
    defaultBankAccountId: z.string().nullable().optional(),
    isActive: z.boolean().optional(),
  }),
});

export const updateAcquirerSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z.object({
    name: z.string().trim().min(1).max(120).optional(),
    bankKeywords: z.array(keyword).optional(),
    debitRate: rate.optional(),
    creditRate: rate.optional(),
    creditInstallmentRate: rate.nullable().optional(),
    installmentRates: z.record(rate).nullable().optional(),
    settlementDaysDebit: z.number().int().min(0).max(365).optional(),
    settlementDaysCredit: z.number().int().min(0).max(365).optional(),
    anticipates: z.boolean().optional(),
    defaultBankAccountId: z.string().nullable().optional(),
    isActive: z.boolean().optional(),
  }),
});

export const acquirerIdSchema = z.object({
  body: z.object({}).optional(),
  params: z.object({ id: z.string().min(1) }),
});
