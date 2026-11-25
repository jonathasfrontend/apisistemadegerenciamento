import { Request, Response } from 'express';
import { asyncHandler } from '../../../../middlewares/error.handler';
import { toApi } from '../../../../domain/finance/money';
import { parseListParams } from '../shared';
import { bankAccountsService } from './bank-accounts.service';

const SORT_FIELDS = ['name', 'bankName', 'type', 'isActive', 'createdAt'] as const;

export const list = asyncHandler(async (req: Request, res: Response) => {
  const params = parseListParams(req.query as Record<string, unknown>, SORT_FIELDS);
  const { items, pagination } = await bankAccountsService.list(req.user!.companyId, params);
  res.json({ status: 'success', data: items, pagination });
});

export const getById = asyncHandler(async (req: Request, res: Response) => {
  const data = await bankAccountsService.getById(req.user!.companyId, req.params.id);
  res.json({ status: 'success', data });
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const data = await bankAccountsService.create(req.user!.companyId, req.body);
  res.status(201).json({ status: 'success', data });
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const data = await bankAccountsService.update(req.user!.companyId, req.params.id, req.body);
  res.json({ status: 'success', data });
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  await bankAccountsService.remove(req.user!.companyId, req.params.id);
  res.status(204).send();
});

export const balance = asyncHandler(async (req: Request, res: Response) => {
  const data = await bankAccountsService.balance(
    req.user!.companyId,
    req.params.id,
    req.query.asOf as string | undefined
  );
  res.json({
    status: 'success',
    data: {
      ...data,
      balance: toApi(data.balance),
      initialBalance: toApi(data.initialBalance),
      totalIn: toApi(data.totalIn),
      totalOut: toApi(data.totalOut),
    },
  });
});
