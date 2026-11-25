import { z } from 'zod';

const dateField = z
  .string()
  .min(1, 'Data é obrigatória')
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Data inválida')
  .transform((value) => new Date(value));

const accountType = z.enum(['CHECKING', 'SAVINGS', 'PAYMENT_ACCOUNT']);

export const listBankAccountsSchema = z.object({
  body: z.object({}).optional(),
  query: z.object({
    page: z.string().optional(),
    limit: z.string().optional(),
    isActive: z.enum(['true', 'false', '1', '0']).optional(),
    sort: z.string().optional(),
  }),
});

export const createBankAccountSchema = z.object({
  body: z.object({
    name: z.string().trim().min(1, 'Nome é obrigatório').max(120),
    bankCode: z.string().trim().max(10).nullable().optional(),
    bankName: z.string().trim().max(120).nullable().optional(),
    agency: z.string().trim().max(20).nullable().optional(),
    accountNumber: z.string().trim().max(30).nullable().optional(),
    type: accountType.optional(),
    ofxBankId: z.string().trim().max(20).nullable().optional(),
    ofxAccountId: z.string().trim().max(50).nullable().optional(),
    initialBalance: z.number({ invalid_type_error: 'Saldo inicial é obrigatório' }),
    initialBalanceDate: dateField,
    color: z.string().trim().max(20).nullable().optional(),
    isActive: z.boolean().optional(),
  }),
});

export const updateBankAccountSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z.object({
    name: z.string().trim().min(1).max(120).optional(),
    bankCode: z.string().trim().max(10).nullable().optional(),
    bankName: z.string().trim().max(120).nullable().optional(),
    agency: z.string().trim().max(20).nullable().optional(),
    accountNumber: z.string().trim().max(30).nullable().optional(),
    type: accountType.optional(),
    ofxBankId: z.string().trim().max(20).nullable().optional(),
    ofxAccountId: z.string().trim().max(50).nullable().optional(),
    color: z.string().trim().max(20).nullable().optional(),
    isActive: z.boolean().optional(),
  }),
});

export const bankAccountIdSchema = z.object({
  body: z.object({}).optional(),
  params: z.object({ id: z.string().min(1) }),
});

export const balanceSchema = z.object({
  body: z.object({}).optional(),
  params: z.object({ id: z.string().min(1) }),
  query: z.object({
    // [F2.4] Corte I10: só date-only válido. `Date.parse('123')` e
    // `Date.parse('2026/11/10')` passariam e mudariam o recorte sem aviso.
    asOf: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'asOf deve ser YYYY-MM-DD')
      .refine((value) => {
        const parsed = new Date(`${value}T00:00:00.000Z`);
        return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
      }, 'asOf inválido')
      .optional(),
  }),
});
