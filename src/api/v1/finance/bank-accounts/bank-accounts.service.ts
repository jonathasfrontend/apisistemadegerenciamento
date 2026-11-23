import { Prisma } from '@prisma/client';
import prisma from '../../../../config/db';
import { AppError } from '../../../../middlewares/error.handler';
import { buildPagination, ListParams, orderBy } from '../shared';

export type CreateBankAccountInput = {
  name: string;
  bankCode?: string | null;
  bankName?: string | null;
  agency?: string | null;
  accountNumber?: string | null;
  type?: 'CHECKING' | 'SAVINGS' | 'PAYMENT_ACCOUNT';
  ofxBankId?: string | null;
  ofxAccountId?: string | null;
  initialBalance: number;
  initialBalanceDate: Date;
  color?: string | null;
  isActive?: boolean;
};

export class BankAccountsService {
  async list(companyId: string, params: ListParams) {
    const where = {
      companyId,
      ...(params.isActive !== undefined ? { isActive: params.isActive } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.bankAccount.findMany({
        where,
        orderBy: orderBy(params) as Prisma.BankAccountOrderByWithRelationInput,
        skip: (params.page - 1) * params.limit,
        take: params.limit,
      }),
      prisma.bankAccount.count({ where }),
    ]);
    return { items, pagination: buildPagination(params.page, params.limit, total) };
  }

  async getById(companyId: string, id: string) {
    const account = await prisma.bankAccount.findFirst({ where: { id, companyId } });
    if (!account) throw new AppError('Conta bancária não encontrada', 404);
    return account;
  }

  create(companyId: string, data: CreateBankAccountInput) {
    return prisma.bankAccount.create({ data: { ...data, companyId } });
  }

  async update(companyId: string, id: string, data: Partial<CreateBankAccountInput>) {
    await this.getById(companyId, id);
    return prisma.bankAccount.update({ where: { id }, data });
  }

  async remove(companyId: string, id: string) {
    await this.getById(companyId, id);
    await prisma.bankAccount.delete({ where: { id } });
  }

  /**
   * F1 (I10 simplificado): `BankTransaction` só existe na Fase 2. Até lá o
   * saldo é o saldo inicial — inclusive para `asOf` posterior à data inicial.
   * O formato já reserva `balance`/`asOf` para não quebrar o contrato da F2.
   */
  async balance(companyId: string, id: string, asOf?: string) {
    const account = await this.getById(companyId, id);
    if (asOf && Number.isNaN(Date.parse(asOf))) {
      throw new AppError('asOf inválido', 400);
    }
    return {
      balance: account.initialBalance,
      initialBalance: account.initialBalance,
      initialBalanceDate: account.initialBalanceDate,
      asOf: asOf ? new Date(asOf) : new Date(),
      source: 'F1_INITIAL_BALANCE_ONLY',
      note: 'Saldo calculado disponível apenas a partir da Fase 2 (BankTransaction).',
    };
  }
}

export const bankAccountsService = new BankAccountsService();
