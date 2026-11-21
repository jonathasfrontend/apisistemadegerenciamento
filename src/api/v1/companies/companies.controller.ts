import { Request, Response } from 'express';
import { companiesService } from './companies.service';
import { asyncHandler } from '../../../middlewares/error.handler';
import { parseLimit, parsePage } from '../../../utils/pagination';

export const list = asyncHandler(async (req: Request, res: Response) => {
  const page = parsePage(req.query.page);
  const limit = parseLimit(req.query.limit);
  const { items, pagination } = await companiesService.list(page, limit);

  res.json({
    status: 'success',
    data: items,
    pagination,
  });
});

export const getById = asyncHandler(async (req: Request, res: Response) => {
  const company = await companiesService.getById(req.params.id);

  res.json({
    status: 'success',
    data: company,
  });
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const company = await companiesService.create(req.body);

  res.status(201).json({
    status: 'success',
    data: company,
  });
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const company = await companiesService.update(req.params.id, req.body);

  res.json({
    status: 'success',
    data: company,
  });
});
