import { Request, Response } from 'express';
import { WaitlistService } from './waitlist.service';
import { logger } from '../../../utils/logger';

export class WaitlistController {
  private waitlistService: WaitlistService;

  constructor() {
    this.waitlistService = new WaitlistService();
  }

  create = async (req: Request, res: Response): Promise<void> => {
    try {
      const entry = await this.waitlistService.create(req.body);
      logger.info(`Waitlist entry created: ${entry.id}`);
      res.status(201).json({ status: 'success', data: { entry } });
    } catch (error: any) {
      logger.error('Error creating waitlist entry:', error);
      res.status(400).json({ status: 'error', message: error.message });
    }
  };

  list = async (req: Request, res: Response): Promise<void> => {
    try {
      const { isContacted } = req.query;
      const entries = await this.waitlistService.list(
        isContacted !== undefined ? isContacted === 'true' : undefined
      );
      res.json({ status: 'success', data: entries });
    } catch (error: any) {
      logger.error('Error listing waitlist:', error);
      res.status(400).json({ status: 'error', message: error.message });
    }
  };

  getById = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const entry = await this.waitlistService.getById(id);
      
      if (!entry) {
        res.status(404).json({ status: 'error', message: 'Waitlist entry not found' });
        return;
      }
      
      res.json({ status: 'success', data: { entry } });
    } catch (error: any) {
      logger.error('Error getting waitlist entry:', error);
      res.status(400).json({ status: 'error', message: error.message });
    }
  };

  update = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const entry = await this.waitlistService.update(id, req.body);
      logger.info(`Waitlist entry updated: ${id}`);
      res.json({ status: 'success', data: { entry } });
    } catch (error: any) {
      logger.error('Error updating waitlist entry:', error);
      res.status(400).json({ status: 'error', message: error.message });
    }
  };

  markAsContacted = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const entry = await this.waitlistService.markAsContacted(id);
      logger.info(`Waitlist entry marked as contacted: ${id}`);
      res.json({ status: 'success', data: { entry } });
    } catch (error: any) {
      logger.error('Error marking as contacted:', error);
      res.status(400).json({ status: 'error', message: error.message });
    }
  };

  delete = async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      await this.waitlistService.delete(id);
      logger.info(`Waitlist entry deleted: ${id}`);
      res.json({ status: 'success', message: 'Entry deleted successfully' });
    } catch (error: any) {
      logger.error('Error deleting entry:', error);
      res.status(400).json({ status: 'error', message: error.message });
    }
  };
}

export const waitlistController = new WaitlistController();
