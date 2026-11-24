import { z } from 'zod';

const isoDate = (field: string) =>
  z
    .string()
    .refine((raw) => !Number.isNaN(new Date(raw).getTime()), `${field} inválida`);

export const listOtherIncomesSchema = z.object({
  body: z.object({}).optional(),
  query: z.object({
    page: z.string().optional(),
    limit: z.string().optional(),
    sort: z.string().optional(),
    isActive: z.enum(['true', 'false', '1', '0']).optional(),
  }),
});

const baseBody = {
  description: z.string().trim().min(1, 'Descrição é obrigatória').max(200),
  amount: z.number().positive('amount deve ser positivo').finite(),
  receivedAt: isoDate('receivedAt'),
  categoryId: z.string().min(1).nullable().optional(),
  bankAccountId: z.string().min(1).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  source: z.enum(['MANUAL', 'RECURRING', 'BANK_RECONCILIATION']).optional(),
};

export const createOtherIncomeSchema = z.object({ body: z.object(baseBody) });

export const updateOtherIncomeSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z.object(baseBody).partial(),
});

export const otherIncomeIdSchema = z.object({
  body: z.object({}).optional(),
  params: z.object({ id: z.string().min(1) }),
});
