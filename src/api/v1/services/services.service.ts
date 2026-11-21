import { Service } from '@prisma/client';
import { createPrismaClient } from '../../../config/db';
import { AppError } from '../../../middlewares/error.handler';

const prisma = createPrismaClient();

interface CreateServiceDTO {
  name: string;
  description?: string;
  durationMinutes: number;
  price: number;
  category: string;
  allowsCombo?: boolean;
}

interface UpdateServiceDTO {
  name?: string;
  description?: string;
  durationMinutes?: number;
  price?: number;
  category?: string;
  isActive?: boolean;
  allowsCombo?: boolean;
}

interface ServiceFilters {
  category?: string;
  isActive?: boolean;
  search?: string;
  limit?: number;
}

export class ServicesService {
  // 0B.1: companyId sempre do req.user; toda query é escopada.
  async create(data: CreateServiceDTO, companyId: string): Promise<Service> {
    return await prisma.service.create({
      data: {
        ...data,
        companyId,
        allowsCombo: data.allowsCombo ?? true,
      },
    });
  }

  async list(filters: ServiceFilters = {}, companyId: string): Promise<Service[]> {
    const where: any = { companyId };

    if (filters.category) {
      where.category = filters.category;
    }

    if (filters.isActive !== undefined) {
      where.isActive = filters.isActive;
    }

    if (filters.search) {
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { category: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    return await prisma.service.findMany({
      where,
      orderBy: [
        { category: 'asc' },
        { name: 'asc' },
      ],
      // Limite opcional: usado pela busca global para não puxar a tabela inteira
      ...(filters.limit ? { take: filters.limit } : {}),
    });
  }

  async getById(id: string, companyId: string): Promise<Service | null> {
    return await prisma.service.findFirst({
      where: { id, companyId },
    });
  }

  async update(id: string, data: UpdateServiceDTO, companyId: string): Promise<Service> {
    const existing = await this.getById(id, companyId);
    if (!existing) throw new AppError('Service not found', 404);

    return await prisma.service.update({
      where: { id },
      data,
    });
  }

  /** Deletar serviço (soft delete) */
  async delete(id: string, companyId: string): Promise<Service> {
    const existing = await this.getById(id, companyId);
    if (!existing) throw new AppError('Service not found', 404);

    return await prisma.service.update({
      where: { id },
      data: { isActive: false },
    });
  }

  async listCategories(companyId: string): Promise<string[]> {
    const services = await prisma.service.findMany({
      where: { companyId },
      select: { category: true },
      distinct: ['category'],
      orderBy: { category: 'asc' },
    });

    return services.map(s => s.category);
  }
}
