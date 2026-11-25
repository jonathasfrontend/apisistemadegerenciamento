import { Request, Response } from 'express';
import { asyncHandler } from '../../../../middlewares/error.handler';
import { parsePage } from '../../../../utils/pagination';
import { parseListParams } from '../shared';
import { importsService, UploadedFile } from './imports.service';

const SORT_FIELDS = ['createdAt', 'status', 'fileName', 'periodStart'] as const;

/** Multipart chega como string: "true"/"1" => true. */
const parseBool = (value: unknown): boolean => value === 'true' || value === '1';

/** Linhas de importação aceitam até 200 por página (spec §9.1). */
const parseRowsLimit = (raw: unknown): number => {
  if (raw === undefined || raw === null || String(raw).trim() === '') return 100;
  const parsed = Number(String(raw).trim());
  if (!Number.isInteger(parsed)) return 100;
  return Math.min(Math.max(parsed, 1), 200);
};

export const upload = asyncHandler(async (req: Request, res: Response) => {
  const file = (req as Request & { file?: UploadedFile }).file;

  const result = await importsService.upload(req.user!.companyId, req.user!.id, {
    file: file as UploadedFile,
    bankAccountId: req.body.bankAccountId,
    kind: req.body.kind ?? 'BANK_STATEMENT',
    invertSigns: parseBool(req.body.invertSigns),
    force: parseBool(req.body.force),
  });

  if (result.alreadyImported) {
    return res.status(200).json({
      status: 'success',
      data: {
        batchId: result.batch.id,
        status: result.batch.status,
        alreadyImported: true,
      },
      warning: {
        code: 'IMPORT_ALREADY_IMPORTED',
        message: 'Este arquivo já foi importado e confirmado nesta conta.',
      },
    });
  }

  return res.status(202).json({
    status: 'success',
    data: { batchId: result.batch.id, status: result.batch.status },
  });
});

export const list = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as Record<string, unknown>;
  const params = parseListParams(query, SORT_FIELDS);
  const status = typeof query.status === 'string' ? query.status : undefined;

  const { items, pagination } = await importsService.list(
    req.user!.companyId,
    params,
    status as never
  );
  res.json({ status: 'success', data: items, pagination });
});

export const getById = asyncHandler(async (req: Request, res: Response) => {
  const data = await importsService.getById(req.user!.companyId, req.params.id);
  res.json({ status: 'success', data });
});

export const rows = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as Record<string, unknown>;
  const { items, pagination } = await importsService.getRows(req.user!.companyId, req.params.id, {
    page: parsePage(query.page),
    limit: parseRowsLimit(query.limit),
  });
  res.json({ status: 'success', data: items, pagination });
});
