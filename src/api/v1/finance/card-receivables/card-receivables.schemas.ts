import { z } from 'zod';

/**
 * Data inválida não pode virar `undefined`: o service removeria o filtro e a
 * listagem devolveria TODOS os recebíveis do tenant em vez de 400.
 */
const optionalDate = (field: string) =>
  z
    .string()
    .refine((raw) => !Number.isNaN(new Date(raw).getTime()), `${field} inválida`)
    .optional();

/** [F1.3] GET /card-receivables — filtros + paginação. companyId nunca vem da query. */
export const listReceivablesSchema = z.object({
  body: z.object({}).optional(),
  query: z.object({
    page: z.string().optional(),
    limit: z.string().optional(),
    sort: z.string().optional(),
    acquirerId: z.string().optional(),
    paymentId: z.string().optional(),
    isReconciled: z.enum(['true', 'false', '1', '0']).optional(),
    from: optionalDate('from'),
    to: optionalDate('to'),
  }),
});
