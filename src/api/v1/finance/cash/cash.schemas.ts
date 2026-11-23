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
