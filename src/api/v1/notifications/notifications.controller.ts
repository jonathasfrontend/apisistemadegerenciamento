import { Request, Response } from 'express';
import { NotificationsService } from './notifications.service';
import { asyncHandler } from '../../../middlewares/error.handler';
import { parseLimit, parsePage } from '../../../utils/pagination';

const notificationsService = new NotificationsService();

/**
 * Normaliza page/limit: NaN, negativo ou limite absurdo viram erro de
 * validação do Prisma (500) ou carregam a lista inteira do usuário.
 * Página tem teto (1000) porque `skip` grande pressiona o banco sem ganho.
 */
function parsePagination(query: Request['query']) {
  const page = parsePage(query.page);
  const limit = parseLimit(query.limit);

  return { page, limit };
}

export const getNotifications = asyncHandler(
  async (req: Request, res: Response) => {
    const { page, limit } = parsePagination(req.query);

    const result = await notificationsService.list(
      req.user!.id,
      req.user!.companyId,
      page,
      limit
    );

    res.json({
      status: 'success',
      data: result,
    });
  }
);

export const getUnreadCount = asyncHandler(
  async (req: Request, res: Response) => {
    const count = await notificationsService.unreadCount(req.user!.id, req.user!.companyId);

    res.json({
      status: 'success',
      data: { count },
    });
  }
);

export const markRead = asyncHandler(
  async (req: Request, res: Response) => {
    try {
      const notification = await notificationsService.markRead(
        req.user!.id,
        req.params.id,
        req.user!.companyId
      );

      res.json({
        status: 'success',
        data: { notification },
      });
    } catch (error: any) {
      if (error.statusCode === 404) {
        res.status(404).json({
          status: 'error',
          message: 'Notification not found',
        });
        return;
      }
      throw error;
    }
  }
);

export const markAllRead = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await notificationsService.markAllRead(req.user!.id, req.user!.companyId);

    res.json({
      status: 'success',
      data: result,
    });
  }
);
