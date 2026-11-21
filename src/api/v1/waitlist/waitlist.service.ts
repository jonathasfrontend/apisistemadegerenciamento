import { Waitlist } from '@prisma/client';
import { createPrismaClient } from '../../../config/db';
import { AppError } from '../../../middlewares/error.handler';

const prisma = createPrismaClient();

interface CreateWaitlistDTO {
  clientName: string;
  clientPhone: string;
  serviceId: string;
  preferredDate?: Date;
  notes?: string;
}

export class WaitlistService {
  // 0B.1: toda query é escopada por companyId.
  async create(data: CreateWaitlistDTO, companyId: string): Promise<Waitlist> {
    const service = await prisma.service.findFirst({
      where: { id: data.serviceId, companyId },
      select: { id: true },
    });
    if (!service) throw new AppError('Service not found', 404);

    return await prisma.waitlist.create({
      data: {
        ...data,
        companyId,
      },
    });
  }

  async list(companyId: string, isContacted?: boolean): Promise<Waitlist[]> {
    return await prisma.waitlist.findMany({
      where: {
        companyId,
        ...(isContacted !== undefined ? { isContacted } : {}),
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async getById(id: string, companyId: string): Promise<Waitlist | null> {
    return await prisma.waitlist.findFirst({
      where: { id, companyId },
    });
  }

  async update(id: string, data: { isContacted?: boolean; notes?: string }, companyId: string): Promise<Waitlist> {
    if (!await this.getById(id, companyId)) throw new AppError('Waitlist entry not found', 404);

    return await prisma.waitlist.update({
      where: { id },
      data,
    });
  }

  async markAsContacted(id: string, companyId: string): Promise<Waitlist> {
    if (!await this.getById(id, companyId)) throw new AppError('Waitlist entry not found', 404);

    return await prisma.waitlist.update({
      where: { id },
      data: { isContacted: true },
    });
  }

  async delete(id: string, companyId: string): Promise<Waitlist> {
    if (!await this.getById(id, companyId)) throw new AppError('Waitlist entry not found', 404);

    return await prisma.waitlist.delete({
      where: { id },
    });
  }
}
