import { z } from 'zod';

// `body` explícito é obrigatório: validateZod só usa {body, query, params}
// quando o schema declara `body` (middleware compartilhado, não mexer aqui).
const emptyBody = z.object({}).optional();

export const listRegistersSchema = z.object({
  body: emptyBody,
  query: z.object({
    page: z.string().optional(),
    limit: z.string().optional(),
    isActive: z.enum(['true', 'false', '1', '0']).optional(),
    sort: z.string().optional(),
  }),
});

export const createRegisterSchema = z.object({
  body: z.object({
    name: z.string().trim().min(1, 'Nome é obrigatório').max(120),
    isActive: z.boolean().optional(),
  }),
});

export const updateRegisterSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z.object({
    name: z.string().trim().min(1).max(120).optional(),
    isActive: z.boolean().optional(),
  }),
});

export const registerIdSchema = z.object({
  body: emptyBody,
  params: z.object({ id: z.string().min(1) }),
});

// ---------------------------------------------------------------------------
// F1.2 — sessões de caixa
// ---------------------------------------------------------------------------

export const openSessionSchema = z.object({
  body: z.object({
    registerId: z.string().min(1),
    openingBalance: z.number().min(0, 'Saldo inicial não pode ser negativo'),
  }),
});

export const currentSessionSchema = z.object({
  body: emptyBody,
  query: z.object({ registerId: z.string().min(1) }),
});

export const listSessionsSchema = z.object({
  body: emptyBody,
  query: z.object({
    page: z.string().optional(),
    limit: z.string().optional(),
    status: z.enum(['OPEN', 'CLOSED']).optional(),
    registerId: z.string().optional(),
    sort: z.string().optional(),
  }),
});

export const sessionIdSchema = z.object({
  body: emptyBody,
  params: z.object({ id: z.string().min(1) }),
});

const MOVEMENT_TYPES = [
  'SALE', 'SUPPLY', 'WITHDRAWAL', 'EXPENSE', 'REFUND', 'ADJUSTMENT',
] as const;

export const createMovementSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z
    .object({
      type: z.enum(MOVEMENT_TYPES),
      direction: z.enum(['IN', 'OUT']),
      amount: z.number().positive('Valor deve ser maior que zero'),
      description: z.string().trim().min(1).optional(),
      categoryId: z.string().nullable().optional(),
      bankAccountId: z.string().nullable().optional(),
      paymentId: z.string().nullable().optional(),
      expenseId: z.string().nullable().optional(),
    })
    // C2: SALE usa nome do cliente/serviço; os demais exigem descrição.
    .refine((data) => data.type === 'SALE' || Boolean(data.description?.trim()), {
      message: 'Descrição é obrigatória',
      path: ['description'],
    }),
});

export const voidMovementSchema = z.object({
  params: z.object({ id: z.string().min(1), mid: z.string().min(1) }),
  body: z.object({ reason: z.string().trim().min(1, 'Motivo do estorno é obrigatório') }),
});

export const closeSessionSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z.object({
    countedCash: z.number().min(0, 'Valor contado não pode ser negativo'),
    closingNotes: z.string().trim().optional(),
  }),
});

export const reopenSessionSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z.object({ reason: z.string().trim().min(1, 'Motivo da reabertura é obrigatório') }),
});
