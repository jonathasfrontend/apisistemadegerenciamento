/**
 * [F1.4] Schemas da fachada /finance/payables.
 * Regras de negócio que devem devolver 422 com `code` (conflito
 * parcelamento/recorrência, conta bancária obrigatória) ficam no service —
 * `validateZod` sempre devolve 400. Aqui só forma/enum.
 */
import { z } from 'zod';

const PAYMENT_METHODS = ['CASH', 'DEBIT', 'CREDIT', 'PIX', 'LINK', 'WALLET'] as const;
const RECURRENCE_INTERVALS = ['WEEKLY', 'MONTHLY', 'YEARLY'] as const;
const STATUSES = ['CANCELED', 'PAID', 'OVERDUE', 'DUE_TODAY', 'PENDING'] as const;

const id = z.object({ id: z.string().min(1) });

export const createPayableSchema = z.object({
  body: z.object({
    description: z.string().min(1),
    category: z.string().min(1),
    amount: z.number().positive(),
    dueDate: z.coerce.date(),
    notes: z.string().optional(),
    categoryId: z.string().optional(),
    supplierId: z.string().optional(),
    installments: z.number().int().min(2).max(360).optional(),
    recurrenceInterval: z.enum(RECURRENCE_INTERVALS).optional(),
    recurrenceEndsAt: z.coerce.date().optional(),
  }),
});

export const updatePayableSchema = z.object({
  body: z.object({
    description: z.string().min(1).optional(),
    category: z.string().min(1).optional(),
    amount: z.number().positive().optional(),
    dueDate: z.coerce.date().optional(),
    paidAt: z.coerce.date().optional(),
    notes: z.string().optional(),
    categoryId: z.string().optional(),
    supplierId: z.string().optional(),
  }),
  params: id,
});

export const payPayableSchema = z.object({
  body: z.object({
    paidAt: z.coerce.date(),
    paidAmount: z.number().positive().optional(),
    paymentMethod: z.enum(PAYMENT_METHODS),
    bankAccountId: z.string().min(1).optional(),
  }),
  params: id,
});

export const listPayablesSchema = z.object({
  body: z.object({}).optional(),
  query: z
    .object({
      page: z.string().optional(),
      limit: z.string().optional(),
      sort: z.string().optional(),
      status: z.enum(STATUSES).optional(),
      isPaid: z.string().optional(),
    })
    .passthrough(),
});

export const payableIdSchema = z.object({
  body: z.object({}).optional(),
  params: id,
});
