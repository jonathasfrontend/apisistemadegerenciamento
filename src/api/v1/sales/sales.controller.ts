import { Request, Response } from 'express';
import { SalesService } from './sales.service';
import { logger } from '../../../utils/logger';
import { AppError } from '../../../middlewares/error.handler';

export class SalesController {
  private salesService: SalesService;

  constructor() {
    this.salesService = new SalesService();
  }

  create = async (req: Request, res: Response): Promise<void> => {
    try {
      const sale = await this.salesService.create(req.body, req.user!.companyId);
      logger.info(`Sale created: ${sale.id}`);
      res.status(201).json({ status: 'success', data: { sale } });
    } catch (error: any) {
      logger.error('Error creating sale:', error);
      // Mesmo contrato de Payments: AppError preserva status/código (ex.: 404
      // de acquirer de outro tenant) em vez de virar 400 genérico.
      const status = error instanceof AppError ? error.statusCode : 400;
      res.status(status).json({
        status: 'error',
        message: error.message || 'Failed to create sale',
        ...(error instanceof AppError && error.code ? { code: error.code } : {}),
      });
    }
  };

  list = async (req: Request, res: Response): Promise<void> => {
    try {
      const { startDate, endDate, clientId } = req.query;
      const filters: any = {};
      if (clientId) filters.clientId = clientId as string;
      if (startDate || endDate) {
        filters.dateRange = {
          start: startDate ? new Date(startDate as string) : undefined,
          end: endDate ? new Date(endDate as string) : undefined,
        };
      }
      const sales = await this.salesService.list(filters, req.user!.companyId);
      res.json({ status: 'success', data: sales });
    } catch (error: any) {
      logger.error('Error listing sales:', error);
      res.status(400).json({ status: 'error', message: error.message || 'Failed to list sales' });
    }
  };

  getById = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const sale = await this.salesService.getById(id, req.user!.companyId);
      if (!sale) {
        res.status(404).json({ status: 'error', message: 'Sale not found' });
        return;
      }
      res.json({ status: 'success', data: { sale } });
    } catch (error: any) {
      logger.error('Error getting sale:', error);
      res.status(400).json({ status: 'error', message: error.message || 'Failed to get sale' });
    }
  };
}

export const salesController = new SalesController();
