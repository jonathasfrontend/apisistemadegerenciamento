import { Request, Response } from 'express';
import { asyncHandler } from '../../../../middlewares/error.handler';
import { parseListParams } from '../shared';
import { acquirersService } from './acquirers.service';

const SORT_FIELDS = ['name', 'debitRate', 'creditRate', 'isActive', 'createdAt'] as const;

export const list = asyncHandler(async (req: Request, res: Response) => {
  const params = parseListParams(req.query as Record<string, unknown>, SORT_FIELDS);
  const { items, pagination } = await acquirersService.list(req.user!.companyId, params);
  res.json({ status: 'success', data: items, pagination });
});

export const getById = asyncHandler(async (req: Request, res: Response) => {
  const data = await acquirersService.getById(req.user!.companyId, req.params.id);
  res.json({ status: 'success', data });
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const data = await acquirersService.create(req.user!.companyId, req.body);
  res.status(201).json({ status: 'success', data });
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const data = await acquirersService.update(req.user!.companyId, req.params.id, req.body);
  res.json({ status: 'success', data });
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  await acquirersService.remove(req.user!.companyId, req.params.id);
  res.status(204).send();
});
