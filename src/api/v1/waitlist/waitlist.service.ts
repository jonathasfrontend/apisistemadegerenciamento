import { Waitlist } from '@prisma/client';
import { createPrismaClient } from '../../../config/db';

const prisma = createPrismaClient();

interface CreateWaitlistDTO {
  clientName: string;
  clientPhone: string;
  serviceId: string;
  preferredDate?: Date;
  notes?: string;
}

export class WaitlistService {
  async create(data: CreateWaitlistDTO): Promise<Waitlist> {
    return await prisma.waitlist.create({
      data: {
        clientName: data.clientName,
        clientPhone: data.clientPhone,
        serviceId: data.serviceId,
        preferredDate: data.preferredDate,
        notes: data.notes,
      },
    });
  }

  async list(isContacted?: boolean): Promise<Waitlist[]> {
    return await prisma.waitlist.findMany({
      where: isContacted !== undefined ? { isContacted } : undefined,
      orderBy: {
        createdAt: 'asc',
      },
    });
  }

  async getById(id: string): Promise<Waitlist | null> {
    return await prisma.waitlist.findUnique({
      where: { id },
    });
  }

  async update(id: string, data: { isContacted?: boolean; notes?: string }): Promise<Waitlist> {
    return await prisma.waitlist.update({
      where: { id },
      data,
    });
  }

  async markAsContacted(id: string): Promise<Waitlist> {
    return await prisma.waitlist.update({
      where: { id },
      data: { isContacted: true },
    });
  }

  async delete(id: string): Promise<Waitlist> {
    return await prisma.waitlist.delete({
      where: { id },
    });
  }
}
