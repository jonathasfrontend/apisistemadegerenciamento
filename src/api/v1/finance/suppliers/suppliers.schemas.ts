import { z } from 'zod';

export const listSuppliersSchema = z.object({
  body: z.object({}).optional(),
  query: z.object({
    page: z.string().optional(),
    limit: z.string().optional(),
    isActive: z.enum(['true', 'false', '1', '0']).optional(),
    sort: z.string().optional(),
  }),
});

export const createSupplierSchema = z.object({
  body: z.object({
    name: z.string().trim().min(1, 'Nome é obrigatório').max(150),
    document: z.string().trim().max(20).nullable().optional(),
    phone: z.string().trim().max(30).nullable().optional(),
    email: z.string().trim().email().max(150).nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
    isActive: z.boolean().optional(),
  }),
});

export const updateSupplierSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: createSupplierSchema.shape.body.partial(),
});

export const supplierIdSchema = z.object({
  body: z.object({}).optional(),
  params: z.object({ id: z.string().min(1) }),
});
