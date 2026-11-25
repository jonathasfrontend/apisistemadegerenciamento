import { Prisma } from '@prisma/client';
import prisma from '../../../../config/db';
import { AppError } from '../../../../middlewares/error.handler';
import { fromCents, toCents } from '../../../../domain/finance/money';
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
   * [F2.4] I10: saldo = initialBalance + Σ BankTransaction.amount onde
   * postedAt >= initialBalanceDate e (asOf ausente ou postedAt <= asOf).
   * Sem transações no recorte, mantém `source=F1_INITIAL_BALANCE_ONLY` para
   * compatibilidade com telas/integrações F1.
   */
  async balance(companyId: string, id: string, asOf?: string) {
    const account = await this.getById(companyId, id);
    const isDateOnly = !!asOf && /^\d{4}-\d{2}-\d{2}$/.test(asOf);
    const isIsoDateTime = !!asOf && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(asOf);
    if (asOf && !isDateOnly && !isIsoDateTime) {
      throw new AppError('asOf deve ser YYYY-MM-DD ou ISO datetime', 400);
    }
    if (isDateOnly) {
      const parsed = new Date(`${asOf}T00:00:00.000Z`);
      if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== asOf) {
        throw new AppError('asOf inválido', 400);
      }
    }

    // `BankTransaction.postedAt` é `@db.Date` (sem hora): meia-noite UTC já
    // inclui o dia inteiro. Overview chama este método com ISO datetime —
    // ambos os formatos são aceitos, lixo (`123`, `2026/11/10`) não é.
    const asOfDate = asOf ? new Date(isDateOnly ? `${asOf}T00:00:00.000Z` : asOf) : new Date();
    const where: Prisma.BankTransactionWhereInput = {
      companyId,
      bankAccountId: id,
      postedAt: {
        gte: account.initialBalanceDate,
        ...(asOf ? { lte: asOfDate } : {}),
      },
    };

    const [agg, inAgg, outAgg, count] = await Promise.all([
      prisma.bankTransaction.aggregate({ where, _sum: { amount: true } }),
      prisma.bankTransaction.aggregate({ where: { ...where, amount: { gt: 0 } }, _sum: { amount: true } }),
      prisma.bankTransaction.aggregate({ where: { ...where, amount: { lt: 0 } }, _sum: { amount: true } }),
      prisma.bankTransaction.count({ where }),
    ]);

    const initialCents = toCents(account.initialBalance);
    const deltaCents = agg._sum.amount ? toCents(agg._sum.amount) : 0;
    const totalInCents = inAgg._sum.amount ? toCents(inAgg._sum.amount) : 0;
    const totalOutCents = outAgg._sum.amount ? Math.abs(toCents(outAgg._sum.amount)) : 0;
    const balanceCents = initialCents + deltaCents;
    const hasTransactions = count > 0;

    return {
      balance: fromCents(balanceCents),
      initialBalance: account.initialBalance,
      initialBalanceDate: account.initialBalanceDate,
      asOf: asOfDate,
      source: hasTransactions ? 'BANK_TRANSACTIONS' : 'F1_INITIAL_BALANCE_ONLY',
      note: hasTransactions
        ? 'Saldo calculado por I10 (saldo inicial + transações bancárias no período).'
        : 'Sem transações no período; exibido saldo inicial.',
      transactionCount: count,
      totalIn: fromCents(totalInCents),
      totalOut: fromCents(totalOutCents),
    };
  }
}

export const bankAccountsService = new BankAccountsService();
