import { z } from 'zod';

const listQuery = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  isActive: z.enum(['true', 'false', '1', '0']).optional(),
  sort: z.string().optional(),
});

export const listCategoriesSchema = z.object({
  body: z.object({}).optional(),
  query: listQuery,
});

const kind = z.enum(['INCOME', 'EXPENSE']);

export const createCategorySchema = z.object({
  body: z.object({
    name: z.string().trim().min(1, 'Nome é obrigatório').max(100),
    kind,
    parentId: z.string().nullable().optional(),
    color: z.string().trim().max(20).nullable().optional(),
    isActive: z.boolean().optional(),
    sortOrder: z.number().int().optional(),
  }),
});

export const updateCategorySchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z.object({
    name: z.string().trim().min(1).max(100).optional(),
    kind: kind.optional(),
    parentId: z.string().nullable().optional(),
    color: z.string().trim().max(20).nullable().optional(),
    isActive: z.boolean().optional(),
    sortOrder: z.number().int().optional(),
  }),
});

export const categoryIdSchema = z.object({
  body: z.object({}).optional(),
  params: z.object({ id: z.string().min(1) }),
});
