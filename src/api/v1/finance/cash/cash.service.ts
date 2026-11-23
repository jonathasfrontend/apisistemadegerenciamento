import { Prisma } from '@prisma/client';
import prisma from '../../../../config/db';
import { AppError } from '../../../../middlewares/error.handler';
import { buildPagination, ListParams, orderBy } from '../shared';

export interface CreateRegisterInput {
  name: string;
  isActive?: boolean;
}

export class CashRegistersService {
  async list(companyId: string, params: ListParams) {
    const where = {
      companyId,
      ...(params.isActive !== undefined ? { isActive: params.isActive } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.cashRegister.findMany({
        where,
        orderBy: orderBy(params) as Prisma.CashRegisterOrderByWithRelationInput,
        skip: (params.page - 1) * params.limit,
        take: params.limit,
      }),
      prisma.cashRegister.count({ where }),
    ]);
    return { items, pagination: buildPagination(params.page, params.limit, total) };
  }

  async getById(companyId: string, id: string) {
    const register = await prisma.cashRegister.findFirst({ where: { id, companyId } });
    if (!register) throw new AppError('Caixa registrador não encontrado', 404);
    return register;
  }

  /** Nome duplicado no tenant → 409, não o 400 genérico do Prisma. */
  async create(companyId: string, data: CreateRegisterInput) {
    const exists = await prisma.cashRegister.findFirst({
      where: { companyId, name: data.name },
      select: { id: true },
    });
    if (exists) {
      throw new AppError('CONFLICT: já existe caixa registrador com este nome', 409);
    }
    try {
      return await prisma.cashRegister.create({ data: { ...data, companyId } });
    } catch (error: unknown) {
      if ((error as { code?: string })?.code === 'P2002') {
        throw new AppError('CONFLICT: já existe caixa registrador com este nome', 409);
      }
      throw error;
    }
  }

  async update(companyId: string, id: string, data: Partial<CreateRegisterInput>) {
    await this.getById(companyId, id);
    if (data.name) {
      const clash = await prisma.cashRegister.findFirst({
        where: { companyId, name: data.name, id: { not: id } },
        select: { id: true },
      });
      if (clash) {
        throw new AppError('CONFLICT: já existe caixa registrador com este nome', 409);
      }
    }
    try {
      return await prisma.cashRegister.update({ where: { id }, data });
    } catch (error: unknown) {
      if ((error as { code?: string })?.code === 'P2002') {
        throw new AppError('CONFLICT: já existe caixa registrador com este nome', 409);
      }
      throw error;
    }
  }
}

export const cashRegistersService = new CashRegistersService();
