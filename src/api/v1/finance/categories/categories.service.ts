import { Prisma } from '@prisma/client';
import prisma from '../../../../config/db';
import { AppError } from '../../../../middlewares/error.handler';
import { buildPagination, ListParams, orderBy } from '../shared';

type CategoryKind = 'INCOME' | 'EXPENSE';

export interface CreateCategoryInput {
  name: string;
  kind: CategoryKind;
  parentId?: string | null;
  color?: string | null;
  isActive?: boolean;
  sortOrder?: number;
}

export interface UpdateCategoryInput extends Partial<CreateCategoryInput> {}

export class CategoriesService {
  async list(companyId: string, params: ListParams) {
    const where = {
      companyId,
      ...(params.isActive !== undefined ? { isActive: params.isActive } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.financialCategory.findMany({
        where,
        orderBy: orderBy(params) as Prisma.FinancialCategoryOrderByWithRelationInput,
        skip: (params.page - 1) * params.limit,
        take: params.limit,
      }),
      prisma.financialCategory.count({ where }),
    ]);
    return { items, pagination: buildPagination(params.page, params.limit, total) };
  }

  async getById(companyId: string, id: string) {
    const category = await prisma.financialCategory.findFirst({ where: { id, companyId } });
    if (!category) throw new AppError('Categoria não encontrada', 404);
    return category;
  }

  create(companyId: string, data: CreateCategoryInput) {
    return prisma.financialCategory.create({ data: { ...data, companyId } });
  }

  async update(companyId: string, id: string, data: UpdateCategoryInput) {
    const current = await this.getById(companyId, id);

    // D-F1.1c: `kind` define a semântica dos lançamentos. Nunca muda em
    // categoria sistema; em categoria do usuário a troca é permitida.
    if (current.isSystem && data.kind && data.kind !== current.kind) {
      throw new AppError('kind de categoria do sistema é imutável', 422);
    }

    const { kind, ...rest } = data;
    return prisma.financialCategory.update({
      where: { id },
      data: kind ? { ...rest, kind } : rest,
    });
  }

  async remove(companyId: string, id: string) {
    const category = await this.getById(companyId, id);
    if (category.isSystem) {
      throw new AppError('Categoria do sistema não pode ser excluída', 409);
    }

    // Contar nas três tabelas que referenciam categoryId (spec §5.1).
    const [expenses, incomes, movements] = await Promise.all([
      prisma.expense.count({ where: { categoryId: id } }),
      prisma.otherIncome.count({ where: { categoryId: id } }),
      prisma.cashMovement.count({ where: { categoryId: id } }),
    ]);
    const total = expenses + incomes + movements;

    if (total > 0) {
      throw new AppError(
        `CATEGORY_IN_USE: categoria possui ${total} vínculo(s) ` +
          `(despesas=${expenses}, outras_receitas=${incomes}, movimentos=${movements})`,
        409
      );
    }

    await prisma.financialCategory.delete({ where: { id } });
  }
}

export const categoriesService = new CategoriesService();
