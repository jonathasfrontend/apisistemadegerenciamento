import { Request, Response } from 'express';
import { asyncHandler } from '../../../../middlewares/error.handler';
import { parseListParams } from '../shared';
import { categoriesService } from './categories.service';

const SORT_FIELDS = ['name', 'kind', 'isActive', 'sortOrder', 'createdAt'] as const;

export const list = asyncHandler(async (req: Request, res: Response) => {
  const params = parseListParams(req.query as Record<string, unknown>, SORT_FIELDS, 'name');
  const { items, pagination } = await categoriesService.list(req.user!.companyId, params);
  res.json({ status: 'success', data: items, pagination });
});

export const getById = asyncHandler(async (req: Request, res: Response) => {
  const data = await categoriesService.getById(req.user!.companyId, req.params.id);
  res.json({ status: 'success', data });
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const data = await categoriesService.create(req.user!.companyId, req.body);
  res.status(201).json({ status: 'success', data });
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const data = await categoriesService.update(req.user!.companyId, req.params.id, req.body);
  res.json({ status: 'success', data });
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  await categoriesService.remove(req.user!.companyId, req.params.id);
  res.status(204).send();
});
