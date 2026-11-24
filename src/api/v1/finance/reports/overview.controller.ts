import { Request, Response } from 'express';
import { AppError, asyncHandler } from '../../../../middlewares/error.handler';
import { overviewService } from './overview.service';

const isCalendarDate = (value: string, parsed: Date) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) && parsed.toISOString().slice(0, 10) === value;

/** [F1.6] GET /finance/overview — envelope {status, data}. */
export const get = asyncHandler(async (req: Request, res: Response) => {
  const q = req.query as Record<string, unknown>;
  const now = new Date();
  const fallbackFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const from = typeof q.from === 'string' ? new Date(`${q.from}T00:00:00.000Z`) : fallbackFrom;
  const to = typeof q.to === 'string' ? new Date(`${q.to}T23:59:59.999Z`) : now;

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new AppError('Período inválido', 400, 'INVALID_PERIOD');
  }
  if (
    (typeof q.from === 'string' && !isCalendarDate(q.from, from)) ||
    (typeof q.to === 'string' && !isCalendarDate(q.to, new Date(`${q.to}T00:00:00.000Z`)))
  ) {
    throw new AppError('Período inválido', 400, 'INVALID_PERIOD');
  }
  if (from.getTime() > to.getTime()) {
    throw new AppError('Período inválido: from posterior a to', 400, 'INVALID_PERIOD');
  }

  const data = await overviewService.get(req.user!.companyId, from, to, now);
  res.json({ status: 'success', data });
});
