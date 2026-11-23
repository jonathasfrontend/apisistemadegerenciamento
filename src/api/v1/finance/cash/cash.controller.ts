import { Request, Response } from 'express';
import { asyncHandler } from '../../../../middlewares/error.handler';
import { parseListParams } from '../shared';
import { cashRegistersService, cashSessionsService } from './cash.service';

const SORT_FIELDS = ['name', 'isActive', 'createdAt'] as const;
const SESSION_SORT_FIELDS = ['openedAt', 'closedAt', 'status'] as const;

export const list = asyncHandler(async (req: Request, res: Response) => {
  const params = parseListParams(req.query as Record<string, unknown>, SORT_FIELDS);
  const { items, pagination } = await cashRegistersService.list(req.user!.companyId, params);
  res.json({ status: 'success', data: items, pagination });
});

export const getById = asyncHandler(async (req: Request, res: Response) => {
  const data = await cashRegistersService.getById(req.user!.companyId, req.params.id);
  res.json({ status: 'success', data });
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const data = await cashRegistersService.create(req.user!.companyId, req.body);
  res.status(201).json({ status: 'success', data });
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const data = await cashRegistersService.update(req.user!.companyId, req.params.id, req.body);
  res.json({ status: 'success', data });
});

// ---------------------------------------------------------------------------
// F1.2 — sessões de caixa
// ---------------------------------------------------------------------------

const canViewAll = (req: Request) => req.user!.permissions.includes('finance.cash.view-all');

export const openSession = asyncHandler(async (req: Request, res: Response) => {
  const data = await cashSessionsService.open(req.user!.companyId, req.user!.id, req.body);
  res.status(201).json({ status: 'success', data });
});

export const currentSession = asyncHandler(async (req: Request, res: Response) => {
  const data = await cashSessionsService.current(req.user!.companyId, req.query.registerId as string);
  res.json({ status: 'success', data });
});

export const listSessions = asyncHandler(async (req: Request, res: Response) => {
  const params = parseListParams(req.query as Record<string, unknown>, SESSION_SORT_FIELDS, 'openedAt');
  const { items, pagination } = await cashSessionsService.list(
    req.user!.companyId,
    req.user!.id,
    params,
    {
      status: req.query.status as string | undefined,
      registerId: req.query.registerId as string | undefined,
    },
    canViewAll(req)
  );
  res.json({ status: 'success', data: items, pagination });
});

export const getSessionById = asyncHandler(async (req: Request, res: Response) => {
  const data = await cashSessionsService.getById(
    req.user!.companyId,
    req.params.id,
    req.user!.id,
    canViewAll(req)
  );
  res.json({ status: 'success', data });
});

export const addMovement = asyncHandler(async (req: Request, res: Response) => {
  const data = await cashSessionsService.addMovement(
    req.user!.companyId,
    req.user!.id,
    req.params.id,
    req.body
  );
  res.status(201).json({ status: 'success', data });
});

export const voidMovement = asyncHandler(async (req: Request, res: Response) => {
  const data = await cashSessionsService.voidMovement(
    req.user!.companyId,
    req.user!.id,
    req.params.id,
    req.params.mid,
    req.body.reason
  );
  res.json({ status: 'success', data });
});

export const closeSession = asyncHandler(async (req: Request, res: Response) => {
  const data = await cashSessionsService.close(
    req.user!.companyId,
    req.user!.id,
    req.params.id,
    req.body
  );
  res.json({ status: 'success', data });
});

export const reopenSession = asyncHandler(async (req: Request, res: Response) => {
  const data = await cashSessionsService.reopen(
    req.user!.companyId,
    req.user!.id,
    req.params.id,
    req.body.reason
  );
  res.json({ status: 'success', data });
});
