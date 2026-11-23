import { Prisma } from '@prisma/client';
import prisma from '../../../../config/db';
import { AppError } from '../../../../middlewares/error.handler';
import { buildPagination, ListParams, normalizeKeyword, orderBy } from '../shared';

/** Campo Json? do Prisma não aceita `null` cru: precisa de Prisma.JsonNull. */
const toJsonField = (value: Record<string, number> | null | undefined) => {
  if (value === null) return Prisma.JsonNull;
  if (value === undefined) return undefined;
  return value as Prisma.InputJsonValue;
};

export type CreateAcquirerInput = {
  name: string;
  bankKeywords: string[];
  debitRate: number;
  creditRate: number;
  creditInstallmentRate?: number | null;
  installmentRates?: Record<string, number> | null;
  settlementDaysDebit?: number;
  settlementDaysCredit?: number;
  anticipates?: boolean;
  defaultBankAccountId?: string | null;
  isActive?: boolean;
};

export class AcquirersService {
  async list(companyId: string, params: ListParams) {
    const where = {
      companyId,
      ...(params.isActive !== undefined ? { isActive: params.isActive } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.acquirer.findMany({
        where,
        orderBy: orderBy(params) as Prisma.AcquirerOrderByWithRelationInput,
        skip: (params.page - 1) * params.limit,
        take: params.limit,
      }),
      prisma.acquirer.count({ where }),
    ]);
    return { items, pagination: buildPagination(params.page, params.limit, total) };
  }

  async getById(companyId: string, id: string) {
    const acquirer = await prisma.acquirer.findFirst({ where: { id, companyId } });
    if (!acquirer) throw new AppError('Maquininha não encontrada', 404);
    return acquirer;
  }

  create(companyId: string, data: CreateAcquirerInput) {
    return prisma.acquirer.create({
      data: {
        ...data,
        companyId,
        bankKeywords: data.bankKeywords.map(normalizeKeyword),
        installmentRates: toJsonField(data.installmentRates),
      },
    });
  }

  async update(companyId: string, id: string, data: Partial<CreateAcquirerInput>) {
    await this.getById(companyId, id);
    // Desestruturar remove as chaves problemáticas do tipo inferido do spread;
    // senão o `null` original volta a aparecer no tipo final do payload.
    const { bankKeywords: _keywords, installmentRates, ...rest } = data;
    return prisma.acquirer.update({
      where: { id },
      data: {
        ...rest,
        ...(_keywords ? { bankKeywords: _keywords.map(normalizeKeyword) } : {}),
        ...(installmentRates !== undefined
          ? { installmentRates: toJsonField(installmentRates) }
          : {}),
      },
    });
  }

  async remove(companyId: string, id: string) {
    await this.getById(companyId, id);
    await prisma.acquirer.delete({ where: { id } });
  }
}

export const acquirersService = new AcquirersService();
