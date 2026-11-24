import { Request, Response } from 'express';
import { asyncHandler } from '../../../../middlewares/error.handler';
import { parseListParams } from '../shared';
import { receivablesService } from './receivables.service';

const SORT_FIELDS = ['expectedDate', 'amount', 'status', 'kind'] as const;

/** [F1.5] GET /receivables — envelope {status, data, pagination, summary}. */
export const list = asyncHandler(async (req: Request, res: Response) => {
  const params = parseListParams(
    req.query as Record<string, unknown>,
    SORT_FIELDS,
    'expectedDate'
  );
  const q = req.query as Record<string, unknown>;

  let isReconciled: boolean | undefined;
  if (q.isReconciled === 'true' || q.isReconciled === '1') isReconciled = true;
  else if (q.isReconciled === 'false' || q.isReconciled === '0') isReconciled = false;

  const from = typeof q.from === 'string' ? new Date(q.from) : undefined;
  const to = typeof q.to === 'string' ? new Date(q.to) : undefined;
  // `to=YYYY-MM-DD` deve incluir o dia inteiro, não meia-noite.
  if (to && typeof q.to === 'string' && !q.to.includes('T')) to.setUTCHours(23, 59, 59, 999);

  const result = await receivablesService.list(req.user!.companyId, {
    page: params.page,
    limit: params.limit,
    sortField: params.field as (typeof SORT_FIELDS)[number],
    sortDirection: params.direction,
    from,
    to,
    isReconciled,
    method: q.method as never,
    status: q.status as never,
    acquirerId: typeof q.acquirerId === 'string' ? q.acquirerId : undefined,
  });

  res.json({
    status: 'success',
    data: result.items,
    pagination: result.pagination,
    summary: result.summary,
  });
});
