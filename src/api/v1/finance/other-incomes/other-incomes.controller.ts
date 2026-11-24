import { Request, Response } from 'express';
import { asyncHandler } from '../../../../middlewares/error.handler';
import { parseListParams } from '../shared';
import { otherIncomesService } from './other-incomes.service';

const SORT_FIELDS = ['receivedAt', 'amount', 'description', 'createdAt'] as const;

export const list = asyncHandler(async (req: Request, res: Response) => {
  const params = parseListParams(req.query as Record<string, unknown>, SORT_FIELDS, 'receivedAt');
  const { items, pagination } = await otherIncomesService.list(req.user!.companyId, params);
  res.json({ status: 'success', data: items, pagination });
});

export const getById = asyncHandler(async (req: Request, res: Response) => {
  const data = await otherIncomesService.getById(req.user!.companyId, req.params.id);
  res.json({ status: 'success', data });
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const data = await otherIncomesService.create(
    req.user!.companyId,
    { ...req.body, receivedAt: new Date(req.body.receivedAt) },
    req.user!.id
  );
  res.status(201).json({ status: 'success', data });
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>;
  const data = await otherIncomesService.update(req.user!.companyId, req.params.id, {
    ...body,
    ...(typeof body.receivedAt === 'string' ? { receivedAt: new Date(body.receivedAt) } : {}),
  } as never);
  res.json({ status: 'success', data });
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  await otherIncomesService.remove(req.user!.companyId, req.params.id);
  res.status(204).send();
});
