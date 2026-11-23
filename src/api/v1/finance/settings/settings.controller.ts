import { Request, Response } from 'express';
import { asyncHandler } from '../../../../middlewares/error.handler';
import { settingsService } from './settings.service';

export const get = asyncHandler(async (req: Request, res: Response) => {
  const data = await settingsService.get(req.user!.companyId);
  res.json({ status: 'success', data });
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const data = await settingsService.update(req.user!.companyId, req.body);
  res.json({ status: 'success', data });
});
