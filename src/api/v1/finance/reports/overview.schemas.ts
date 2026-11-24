import { z } from 'zod';

/** [F1.6] GET /finance/overview?from=YYYY-MM-DD&to=YYYY-MM-DD. */
export const overviewSchema = z.object({
  // `validateZod` só repassa {body, query, params} quando o schema declara body.
  body: z.object({}).optional(),
  query: z.object({
    from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'from deve ser YYYY-MM-DD')
      .optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'to deve ser YYYY-MM-DD').optional(),
  }),
  params: z.object({}).optional(),
});

export type OverviewQuery = z.infer<typeof overviewSchema>['query'];
