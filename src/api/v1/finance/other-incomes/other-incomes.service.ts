/**
 * [F1.5] CRUD de receitas avulsas (OtherIncome), tenant-scoped.
 * FKs opcionais são validadas no mesmo tenant (D-F1.48) antes de gravar.
 * `amount` passa pela fronteira de dinheiro (toCents/fromCents, HALF_UP).
 */
import { Prisma } from '@prisma/client';
import prisma from '../../../../config/db';
import { AppError } from '../../../../middlewares/error.handler';
import { toCents, fromCents, toApi } from '../../../../domain/finance/money';
import { buildPagination, ListParams, orderBy } from '../shared';

export interface CreateOtherIncomeInput {
  description: string;
  amount: number;
  receivedAt: Date;
  categoryId?: string | null;
  bankAccountId?: string | null;
  notes?: string | null;
  source?: 'MANUAL' | 'RECURRING' | 'BANK_RECONCILIATION';
}

async function assertTenantRefs(
  tx: typeof prisma,
  companyId: string,
  categoryId?: string | null,
  bankAccountId?: string | null
): Promise<void> {
  if (categoryId) {
    const category = await tx.financialCategory.findFirst({
      where: { id: categoryId, companyId },
      select: { id: true },
    });
    if (!category) throw new AppError('Categoria financeira não encontrada', 404, 'CATEGORY_NOT_FOUND');
  }
  if (bankAccountId) {
    const bank = await tx.bankAccount.findFirst({
      where: { id: bankAccountId, companyId },
      select: { id: true },
    });
    if (!bank) throw new AppError('Conta bancária não encontrada', 404, 'BANK_ACCOUNT_NOT_FOUND');
  }
}

/** Decimal do Prisma serializa como string no JSON — a API devolve number (spec D7). */
function present<T extends { amount: Prisma.Decimal }>(row: T): Omit<T, 'amount'> & { amount: number } {
  return { ...row, amount: toApi(row.amount) };
}

function normalizeAmount(amount: number) {
  const cents = toCents(amount);
  if (cents <= 0) {
    throw new AppError('amount deve resultar em pelo menos um centavo', 422, 'INVALID_AMOUNT');
  }
  return fromCents(cents);
}

export class OtherIncomesService {
  async list(companyId: string, params: ListParams) {
    const [items, total] = await Promise.all([
      prisma.otherIncome.findMany({
        where: { companyId },
        orderBy: orderBy(params) as never,
        skip: (params.page - 1) * params.limit,
        take: params.limit,
      }),
      prisma.otherIncome.count({ where: { companyId } }),
    ]);
    return { items: items.map(present), pagination: buildPagination(params.page, params.limit, total) };
  }

  async getById(companyId: string, id: string) {
    const item = await prisma.otherIncome.findFirst({ where: { id, companyId } });
    if (!item) throw new AppError('Receita avulsa não encontrada', 404, 'OTHER_INCOME_NOT_FOUND');
    return present(item);
  }

  async create(companyId: string, input: CreateOtherIncomeInput, userId?: string) {
    await assertTenantRefs(prisma, companyId, input.categoryId, input.bankAccountId);
    const amount = normalizeAmount(input.amount);
    const created = await prisma.otherIncome.create({
      data: {
        companyId,
        description: input.description,
        amount,
        receivedAt: input.receivedAt,
        categoryId: input.categoryId ?? null,
        bankAccountId: input.bankAccountId ?? null,
        notes: input.notes ?? null,
        source: input.source ?? 'MANUAL',
        createdById: userId ?? null,
      },
    });
    return present(created);
  }

  async update(companyId: string, id: string, input: Partial<CreateOtherIncomeInput>) {
    await this.getById(companyId, id);
    await assertTenantRefs(prisma, companyId, input.categoryId, input.bankAccountId);
    const amount = input.amount !== undefined ? normalizeAmount(input.amount) : undefined;
    const updated = await prisma.otherIncome.update({
      where: { id },
      data: {
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(amount !== undefined ? { amount } : {}),
        ...(input.receivedAt !== undefined ? { receivedAt: input.receivedAt } : {}),
        ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
        ...(input.bankAccountId !== undefined ? { bankAccountId: input.bankAccountId } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      },
    });
    return present(updated);
  }

  async remove(companyId: string, id: string) {
    await this.getById(companyId, id);
    await prisma.otherIncome.delete({ where: { id } });
  }
}

export const otherIncomesService = new OtherIncomesService();
