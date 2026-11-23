import { Request, Response } from 'express';
import { asyncHandler } from '../../../../middlewares/error.handler';
import { parseListParams } from '../shared';
import { cardReceivablesService } from './card-receivables.service';

const SORT_FIELDS = [
  'expectedDate',
  'installmentNumber',
  'netAmount',
  'feeAmount',
  'isReconciled',
] as const;

function optionalDate(raw: unknown): Date | undefined {
  if (typeof raw !== 'string' || !raw) return undefined;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/** [F1.3] GET /card-receivables — page/limit/acquirerId/from/to/isReconciled/paymentId/sort. */
export const list = asyncHandler(async (req: Request, res: Response) => {
  // CardReceivable não tem createdAt: fallback de ordenação é expectedDate.
  const params = parseListParams(
    req.query as Record<string, unknown>,
    SORT_FIELDS,
    'expectedDate'
  );
  const q = req.query as Record<string, unknown>;

  let isReconciled: boolean | undefined;
  if (q.isReconciled === 'true' || q.isReconciled === '1') isReconciled = true;
  else if (q.isReconciled === 'false' || q.isReconciled === '0') isReconciled = false;

  const { items, pagination } = await cardReceivablesService.list(
    req.user!.companyId,
    params,
    {
      acquirerId: typeof q.acquirerId === 'string' ? q.acquirerId : undefined,
      paymentId: typeof q.paymentId === 'string' ? q.paymentId : undefined,
      isReconciled,
      from: optionalDate(q.from),
      to: optionalDate(q.to),
    }
  );
  res.json({ status: 'success', data: items, pagination });
});
