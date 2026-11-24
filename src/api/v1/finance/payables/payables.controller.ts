/** [F1.4] Controller da fachada A pagar — envelope {status, data, pagination}. */
import { Request, Response } from 'express';
import { PayableStatus } from '../../../../domain/finance/payables/status';
import { asyncHandler } from '../../../../middlewares/error.handler';
import { parseListParams } from '../shared';
import { payablesService } from './payables.service';

const SORT_FIELDS = ['dueDate', 'createdAt', 'description', 'amount', 'isPaid'] as const;

export const list = asyncHandler(async (req: Request, res: Response) => {
  const params = parseListParams(req.query as Record<string, unknown>, SORT_FIELDS);
  const raw = req.query.isPaid;
  const { items, pagination } = await payablesService.list(req.user!.companyId, params, {
    status: req.query.status as PayableStatus | undefined,
    isPaid: raw === 'true' ? true : raw === 'false' ? false : undefined,
  });
  res.json({ status: 'success', data: items, pagination });
});

export const getById = asyncHandler(async (req: Request, res: Response) => {
  const data = await payablesService.getById(req.params.id, req.user!.companyId);
  res.json({ status: 'success', data });
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const data = await payablesService.create(req.body, req.user!.companyId);
  res.status(201).json({ status: 'success', data });
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const data = await payablesService.update(req.params.id, req.body, req.user!.companyId);
  res.json({ status: 'success', data });
});

export const pay = asyncHandler(async (req: Request, res: Response) => {
  const data = await payablesService.pay(
    req.params.id,
    req.body,
    req.user!.companyId,
    req.user!.id
  );
  res.json({ status: 'success', data });
});

export const cancel = asyncHandler(async (req: Request, res: Response) => {
  const data = await payablesService.cancel(req.params.id, req.user!.companyId);
  res.json({ status: 'success', data });
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  const data = await payablesService.remove(req.params.id, req.user!.companyId);
  res.json({ status: 'success', data });
});
