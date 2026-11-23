/** [F1.3] Leitura isolada e paginada de recebíveis de cartão. */
import { Prisma } from '@prisma/client';
import prisma from '../../../../config/db';
import { buildPagination, ListParams, orderBy } from '../shared';

export interface ReceivableFilters {
  acquirerId?: string;
  isReconciled?: boolean;
  from?: Date;
  to?: Date;
  paymentId?: string;
}

export class CardReceivablesService {
  async list(companyId: string, params: ListParams, filters: ReceivableFilters) {
    const where: Prisma.CardReceivableWhereInput = {
      companyId,
      ...(filters.acquirerId ? { acquirerId: filters.acquirerId } : {}),
      ...(filters.isReconciled !== undefined ? { isReconciled: filters.isReconciled } : {}),
      ...(filters.paymentId ? { paymentId: filters.paymentId } : {}),
      ...(filters.from || filters.to
        ? {
            expectedDate: {
              ...(filters.from ? { gte: filters.from } : {}),
              ...(filters.to ? { lte: filters.to } : {}),
            },
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.cardReceivable.findMany({
        where,
        orderBy: orderBy(params) as Prisma.CardReceivableOrderByWithRelationInput,
        skip: (params.page - 1) * params.limit,
        take: params.limit,
      }),
      prisma.cardReceivable.count({ where }),
    ]);
    return { items, pagination: buildPagination(params.page, params.limit, total) };
  }
}

export const cardReceivablesService = new CardReceivablesService();
