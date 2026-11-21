import { Review } from '@prisma/client';
import { createPrismaClient } from '../../../config/db';
import { AppError } from '../../../middlewares/error.handler';

const prisma = createPrismaClient();

interface CreateReviewDTO {
  clientId: string;
  rating: number;
  comment?: string;
  serviceQuality?: number;
  staffBehavior?: number;
  cleanliness?: number;
}

export class ReviewsService {
  // 0B.1: toda leitura/escrita é escopada por companyId.
  async create(data: CreateReviewDTO, companyId: string): Promise<Review> {
    const client = await prisma.client.findFirst({
      where: { id: data.clientId, companyId },
      select: { id: true },
    });
    if (!client) throw new AppError('Client not found', 404);

    return await prisma.review.create({
      data: { ...data, companyId },
      include: {
        client: {
          select: { id: true, name: true },
        },
      },
    });
  }

  async list(companyId: string, clientId?: string): Promise<Review[]> {
    return await prisma.review.findMany({
      where: { companyId, ...(clientId ? { clientId } : {}) },
      include: {
        client: {
          select: { id: true, name: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getStats(companyId: string) {
    const reviews = await prisma.review.findMany({ where: { companyId } });
    const total = reviews.length;

    if (total === 0) {
      return {
        total: 0,
        averageRating: 0,
        averageServiceQuality: 0,
        averageStaffBehavior: 0,
        averageCleanliness: 0,
      };
    }

    const avgRating = reviews.reduce((sum, r) => sum + r.rating, 0) / total;
    const avgServiceQuality = reviews.filter(r => r.serviceQuality).reduce((sum, r) => sum + (r.serviceQuality || 0), 0) / reviews.filter(r => r.serviceQuality).length || 0;
    const avgStaffBehavior = reviews.filter(r => r.staffBehavior).reduce((sum, r) => sum + (r.staffBehavior || 0), 0) / reviews.filter(r => r.staffBehavior).length || 0;
    const avgCleanliness = reviews.filter(r => r.cleanliness).reduce((sum, r) => sum + (r.cleanliness || 0), 0) / reviews.filter(r => r.cleanliness).length || 0;

    return {
      total,
      averageRating: avgRating,
      averageServiceQuality: avgServiceQuality,
      averageStaffBehavior: avgStaffBehavior,
      averageCleanliness: avgCleanliness,
    };
  }
}
