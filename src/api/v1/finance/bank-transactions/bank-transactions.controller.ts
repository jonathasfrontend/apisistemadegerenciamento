import { Request, Response } from 'express';
import { asyncHandler } from '../../../../middlewares/error.handler';
import { parsePage } from '../../../../utils/pagination';
import { bankTransactionsService } from './bank-transactions.service';

/**
 * [F2.4] Teto 200 é requisito do extrato (plano Task 5), diferente do
 * MAX_LIMIT=100 dos cadastros. `utils/pagination.parseLimit` não parametriza
 * o teto, por isso o helper local existe — não é duplicação acidental.
 * `Number` (não `parseInt`) evita aceitar lixo como `12abc` → 12.
 */
const parseStatementLimit = (raw: unknown): number => {
  if (raw === undefined || raw === null || String(raw).trim() === '') return 50;
  const parsed = Number(String(raw).trim());
  if (!Number.isInteger(parsed)) return 50;
  return Math.min(Math.max(parsed, 1), 200);
};

export const list = asyncHandler(async (req: Request, res: Response) => {
  const q = req.query as Record<string, unknown>;
  const { items, pagination, totals } = await bankTransactionsService.list(req.user!.companyId, {
    page: parsePage(q.page),
    limit: parseStatementLimit(q.limit),
    bankAccountId: q.bankAccountId as string | undefined,
    from: q.from as string | undefined,
    to: q.to as string | undefined,
    status: q.status as any,
    direction: q.direction as any,
    method: q.method as string | undefined,
    search: q.search as string | undefined,
    minAmount: q.minAmount !== undefined ? Number(q.minAmount) : undefined,
    maxAmount: q.maxAmount !== undefined ? Number(q.maxAmount) : undefined,
    categoryId: q.categoryId as string | undefined,
  });
  res.json({ status: 'success', data: items, pagination, totals });
});

export const getById = asyncHandler(async (req: Request, res: Response) => {
  const data = await bankTransactionsService.getById(req.user!.companyId, req.params.id);
  res.json({ status: 'success', data });
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const data = await bankTransactionsService.createManual(req.user!.companyId, req.body);
  res.status(201).json({ status: 'success', data });
});

export const patch = asyncHandler(async (req: Request, res: Response) => {
  const data = await bankTransactionsService.patch(req.user!.companyId, req.params.id, req.body);
  res.json({ status: 'success', data });
});
