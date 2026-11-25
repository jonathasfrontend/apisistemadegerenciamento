import { Request, Response } from 'express';
import { asyncHandler } from '../../../../middlewares/error.handler';
import { parsePage } from '../../../../utils/pagination';
import { bankTransactionsService } from './bank-transactions.service';
import {
  buildSuggestions,
  bulkConfirm,
  createEntry,
  markSuggested,
  reconcile,
  summary,
  undo,
} from '../../../../domain/finance/reconciliation/engine';

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

/** [F2.5] Rotas de reconciliação — spec §7.6.5. companyId sempre de req.user. */
export const reconcileTx = asyncHandler(async (req: Request, res: Response) => {
  // `origin` é decisão do servidor (MANUAL aqui, AUTO só no bulk interno).
  const result = await reconcile(req.user!.companyId, req.user!.id, req.params.id, {
    targets: req.body.targets,
  });
  // reload() do engine devolve Decimal cru; a API devolve number via serializeTx.
  const transaction = await bankTransactionsService.getById(req.user!.companyId, req.params.id);
  res.json({ status: 'success', data: { ...result, transaction } });
});

export const undoReconcile = asyncHandler(async (req: Request, res: Response) => {
  const data = await undo(
    req.user!.companyId,
    req.user!.id,
    req.params.id,
    req.body?.deleteCreatedEntries === true
  );
  res.json({ status: 'success', data });
});

export const createEntryFromTx = asyncHandler(async (req: Request, res: Response) => {
  const result = await createEntry(req.user!.companyId, req.user!.id, req.params.id, req.body);
  const transaction = await bankTransactionsService.getById(req.user!.companyId, req.params.id);
  res.status(201).json({ status: 'success', data: { ...result, transaction } });
});

export const getSuggestions = asyncHandler(async (req: Request, res: Response) => {
  const suggestions = await buildSuggestions(req.user!.companyId, req.params.id);
  res.json({ status: 'success', data: { suggestions } });
});

/** Escrita explícita de SUGGESTED — exige finance.reconcile. */
export const persistSuggestions = asyncHandler(async (req: Request, res: Response) => {
  const suggestions = await markSuggested(req.user!.companyId, req.params.id);
  res.json({ status: 'success', data: { suggestions } });
});

export const bulkConfirmSuggestions = asyncHandler(async (req: Request, res: Response) => {
  const data = await bulkConfirm(req.user!.companyId, req.user!.id, req.body.ids);
  res.json({ status: 'success', data });
});

export const reconciliationSummary = asyncHandler(async (req: Request, res: Response) => {
  const data = await summary(req.user!.companyId);
  res.json({ status: 'success', data });
});
