import { z } from 'zod';

const optionalDate = (field: string) =>
  z
    .string()
    .refine((raw) => !Number.isNaN(new Date(raw).getTime()), `${field} inválida`)
    .optional();

/** [F1.5] GET /receivables — filtros + paginação. companyId nunca vem da query. */
export const listReceivablesSchema = z.object({
  body: z.object({}).optional(),
  query: z.object({
    page: z.string().optional(),
    limit: z.string().optional(),
    sort: z.string().optional(),
    from: optionalDate('from'),
    to: optionalDate('to'),
    method: z.enum(['CASH', 'DEBIT', 'CREDIT', 'PIX', 'LINK', 'WALLET']).optional(),
    status: z.enum(['PENDING', 'PAID', 'OVERDUE', 'REFUNDED']).optional(),
    isReconciled: z.enum(['true', 'false', '1', '0']).optional(),
    acquirerId: z.string().optional(),
  }),
});
