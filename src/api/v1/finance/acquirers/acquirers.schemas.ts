import { z } from 'zod';
import { normalizeKeyword } from '../shared';

const keyword = z
  .string()
  .trim()
  .min(1, 'Palavra-chave não pode ser vazia')
  .max(100)
  .transform(normalizeKeyword);

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
    debitRate: z.number({ invalid_type_error: 'Taxa de débito é obrigatória' }).min(0).max(1),
    creditRate: z.number({ invalid_type_error: 'Taxa de crédito é obrigatória' }).min(0).max(1),
    creditInstallmentRate: z.number().min(0).max(1).nullable().optional(),
    installmentRates: z.record(z.number().min(0).max(1)).nullable().optional(),
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
    debitRate: z.number().min(0).max(1).optional(),
    creditRate: z.number().min(0).max(1).optional(),
    creditInstallmentRate: z.number().min(0).max(1).nullable().optional(),
    installmentRates: z.record(z.number().min(0).max(1)).nullable().optional(),
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
