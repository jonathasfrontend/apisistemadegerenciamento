import { Prisma } from '@prisma/client';
import prisma from '../../../../config/db';
import { AppError } from '../../../../middlewares/error.handler';
import { buildPagination, ListParams, orderBy } from '../shared';

export type CreateSupplierInput = {
  name: string;
  document?: string | null;
  phone?: string | null;
  email?: string | null;
  notes?: string | null;
  isActive?: boolean;
};

export class SuppliersService {
  async list(companyId: string, params: ListParams) {
    const where = {
      companyId,
      ...(params.isActive !== undefined ? { isActive: params.isActive } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.supplier.findMany({
        where,
        orderBy: orderBy(params) as Prisma.SupplierOrderByWithRelationInput,
        skip: (params.page - 1) * params.limit,
        take: params.limit,
      }),
      prisma.supplier.count({ where }),
    ]);
    return { items, pagination: buildPagination(params.page, params.limit, total) };
  }

  async getById(companyId: string, id: string) {
    const supplier = await prisma.supplier.findFirst({ where: { id, companyId } });
    if (!supplier) throw new AppError('Fornecedor não encontrado', 404);
    return supplier;
  }

  create(companyId: string, data: CreateSupplierInput) {
    return prisma.supplier.create({ data: { ...data, companyId } });
  }

  async update(companyId: string, id: string, data: Partial<CreateSupplierInput>) {
    await this.getById(companyId, id);
    return prisma.supplier.update({ where: { id }, data });
  }

  async remove(companyId: string, id: string) {
    await this.getById(companyId, id);
    await prisma.supplier.delete({ where: { id } });
  }
}

export const suppliersService = new SuppliersService();
