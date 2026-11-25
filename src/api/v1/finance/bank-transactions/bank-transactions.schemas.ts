import { z } from 'zod';
import { D } from '../../../../domain/finance/money';

/**
 * [F2.4] Data de calendário estrita. `new Date('2026-02-30')` normaliza para
 * 01/03 silenciosamente; sem o round-trip abaixo uma data impossível entraria
 * no filtro/banco e distorceria o I10. A coluna é `@db.Date`, então meia-noite
 * UTC é o corte correto — não há problema de fuso aqui.
 */
const calendarDate = (field: string) =>
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, `${field} deve ser YYYY-MM-DD`)
    .refine((value) => {
      const parsed = new Date(`${value}T00:00:00.000Z`);
      return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
    }, `${field} inválido`);

/** Decimal(14,2): no máximo 2 casas e |valor| <= 999999999999.99. */
const moneyAmount = z
  .number()
  .finite()
  .refine((v) => v !== 0, 'Valor não pode ser zero')
  .refine((v) => D(v).decimalPlaces() <= 2, 'Valor deve ter no máximo 2 casas decimais')
  .refine((v) => D(v).abs().lte('999999999999.99'), 'Valor acima do permitido');

export const listBankTransactionsSchema = z.object({
  body: z.object({}).optional(),
  query: z.object({
    page: z.string().optional(),
    limit: z.string().optional(),
    bankAccountId: z.string().trim().max(60).optional(),
    from: calendarDate('from').optional(),
    to: calendarDate('to').optional(),
    status: z.enum(['PENDING', 'SUGGESTED', 'PARTIAL', 'RECONCILED', 'IGNORED']).optional(),
    direction: z.enum(['IN', 'OUT']).optional(),
    method: z
      .enum(['PIX', 'TED', 'DOC', 'BOLETO', 'CARD_SETTLEMENT', 'FEE', 'INTEREST', 'CASH_DEPOSIT', 'OTHER'])
      .optional(),
    search: z.string().trim().max(200).optional(),
    minAmount: z.string().optional(),
    maxAmount: z.string().optional(),
    categoryId: z.string().trim().max(60).optional(),
  }),
});

export const createBankTransactionSchema = z.object({
  body: z.object({
    bankAccountId: z.string().trim().min(1, 'Conta bancária é obrigatória').max(60),
    postedAt: calendarDate('Data'),
    amount: moneyAmount,
    description: z.string().trim().min(1, 'Descrição é obrigatória').max(500),
    memo: z.string().trim().max(500).nullable().optional(),
    inferredMethod: z
      .enum(['PIX', 'TED', 'DOC', 'BOLETO', 'CARD_SETTLEMENT', 'FEE', 'INTEREST', 'CASH_DEPOSIT', 'OTHER'])
      .optional(),
    categoryId: z.string().trim().max(60).nullable().optional(),
  }),
});

export const getBankTransactionSchema = z.object({
  body: z.object({}).optional(),
  params: z.object({ id: z.string().trim().min(1).max(60) }),
});

export const patchBankTransactionSchema = z.object({
  body: z
    .object({
      categoryId: z.string().trim().max(60).nullable().optional(),
      notes: z.string().trim().max(2000).nullable().optional(),
      status: z.enum(['IGNORED', 'PENDING']).optional(),
    })
    .refine((body) => Object.keys(body).length > 0, {
      message: 'Informe ao menos um campo para editar',
    }),
  params: z.object({ id: z.string().trim().min(1).max(60) }),
});

/** [F2.5] Reconciliação — spec §7.6.5. `amount` é em reais, positivo, ≤ 2 casas. */
const reconcileAmount = z
  .number()
  .finite()
  .positive('Valor do alvo deve ser positivo')
  .refine((v) => D(v).decimalPlaces() <= 2, 'Valor deve ter no máximo 2 casas decimais')
  .refine((v) => D(v).lte('999999999999.99'), 'Valor acima do permitido');

const targetTypes = [
  'PAYMENT',
  'CARD_RECEIVABLE',
  'EXPENSE',
  'OTHER_INCOME',
  'CASH_MOVEMENT',
  'TRANSFER',
] as const;

export const reconcileBankTransactionSchema = z.object({
  body: z.object({
    targets: z
      .array(
        z.object({
          targetType: z.enum(targetTypes),
          targetId: z.string().trim().min(1).max(60),
          amount: reconcileAmount,
        })
      )
      .min(1, 'Informe ao menos um alvo')
      .max(50, 'Máximo de 50 alvos por reconciliação'),
    origin: z.enum(['AUTO', 'RULE', 'MANUAL']).optional(),
  }),
  params: z.object({ id: z.string().trim().min(1).max(60) }),
});

export const undoReconciliationSchema = z.object({
  body: z.object({ deleteCreatedEntries: z.boolean().optional() }).default({}),
  params: z.object({ id: z.string().trim().min(1).max(60) }),
});

export const createEntrySchema = z.object({
  body: z.object({
    description: z.string().trim().min(1, 'Descrição é obrigatória').max(500),
    categoryId: z.string().trim().min(1, 'Categoria é obrigatória').max(60),
    supplierId: z.string().trim().max(60).nullable().optional(),
  }),
  params: z.object({ id: z.string().trim().min(1).max(60) }),
});

export const suggestionsSchema = z.object({
  body: z.object({}).optional(),
  params: z.object({ id: z.string().trim().min(1).max(60) }),
});

export const bulkConfirmSchema = z.object({
  body: z.object({
    ids: z.array(z.string().trim().min(1).max(60)).min(1, 'Informe ao menos um id').max(100),
  }),
});

export const reconciliationSummarySchema = z.object({
  body: z.object({}).optional(),
  query: z.object({}).optional(),
});
