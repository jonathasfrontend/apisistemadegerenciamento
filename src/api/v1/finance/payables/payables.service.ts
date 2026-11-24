/**
 * [F1.4] Fachada A pagar sobre `Expense` — spec:1102-1129.
 * `/expenses` permanece intocado; aqui vivem status derivado, pagamento
 * transacional, parcelamento e recorrência. `companyId` SEMPRE vem de
 * `req.user` recarregado (F0.2), nunca de body/query.
 */
import { randomUUID } from 'node:crypto';
import {
  CashSessionStatus,
  EntrySource,
  Expense,
  PaymentMethod,
  Prisma,
  RecurrenceInterval,
} from '@prisma/client';
import prisma from '../../../../config/db';
import { AppError } from '../../../../middlewares/error.handler';
import { fromCents, toCents } from '../../../../domain/finance/money';
import { buildInstallments, buildRecurrenceDates } from '../../../../domain/finance/payables/schedule';
import { deriveStatus, PayableStatus } from '../../../../domain/finance/payables/status';
import { runSerializable } from '../../../../utils/transaction';
import { buildPagination, ListParams, orderBy } from '../shared';

type Tx = Prisma.TransactionClient;

export interface CreatePayableInput {
  description: string;
  category: string;
  amount: number;
  dueDate: Date;
  notes?: string;
  categoryId?: string;
  supplierId?: string;
  installments?: number;
  recurrenceInterval?: RecurrenceInterval;
  recurrenceEndsAt?: Date;
}

export interface UpdatePayableInput {
  description?: string;
  category?: string;
  amount?: number;
  dueDate?: Date;
  paidAt?: Date;
  notes?: string;
  categoryId?: string;
  supplierId?: string;
}

export interface PayPayableInput {
  paidAt: Date;
  paidAmount?: number;
  paymentMethod: PaymentMethod;
  bankAccountId?: string;
}

export interface ListPayablesFilters {
  status?: PayableStatus;
  isPaid?: boolean;
}

/** `paidAt` é o nome da API; `paidDate` segue presente para compatibilidade. */
type PresentedExpense = Expense & { status: PayableStatus; paidAt: Date | null };

/** FKs opcionais do body precisam pertencer ao mesmo tenant (review F1.4). */
async function assertTenantRefs(
  tx: Tx,
  companyId: string,
  categoryId?: string,
  supplierId?: string
): Promise<void> {
  if (categoryId) {
    const category = await tx.financialCategory.findFirst({
      where: { id: categoryId, companyId },
      select: { id: true },
    });
    if (!category) {
      throw new AppError('Categoria financeira não encontrada', 404, 'CATEGORY_NOT_FOUND');
    }
  }
  if (supplierId) {
    const supplier = await tx.supplier.findFirst({
      where: { id: supplierId, companyId },
      select: { id: true },
    });
    if (!supplier) {
      throw new AppError('Fornecedor não encontrado', 404, 'SUPPLIER_NOT_FOUND');
    }
  }
}

/** Mesma precedência de F1.3: sessão OPEN do operador → única OPEN da empresa. */
async function resolveOpenSession(tx: Tx, companyId: string, userId: string) {
  const own = await tx.cashSession.findFirst({
    where: { companyId, status: CashSessionStatus.OPEN, openedById: userId },
    orderBy: { openedAt: 'desc' },
  });
  if (own) return own;

  const any = await tx.cashSession.findFirst({
    where: { companyId, status: CashSessionStatus.OPEN },
    orderBy: { openedAt: 'desc' },
  });
  if (!any) {
    throw new AppError(
      'É necessário abrir um caixa antes de pagar em dinheiro',
      409,
      'CASH_SESSION_REQUIRED'
    );
  }
  return any;
}

/** Três meses corridos a partir da maior data entre hoje e o vencimento original. */
function threeMonthsFrom(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 3, date.getUTCDate(), 12));
}

export class PayablesService {
  /** API expõe `paidAt`; coluna é `paidDate`. Nada é persistido aqui. */
  present(expense: Expense): PresentedExpense {
    return {
      ...expense,
      paidAt: expense.paidDate,
      status: deriveStatus(expense, new Date()),
    };
  }

  /** POST devolve sempre a lista criada (1 item sem parcelamento, N com). */
  async create(input: CreatePayableInput, companyId: string): Promise<PresentedExpense[]> {
    if (input.installments && input.recurrenceInterval) {
      throw new AppError(
        'Parcelamento e recorrência não podem ser combinados',
        422,
        'INSTALLMENTS_RECURRENCE_CONFLICT'
      );
    }

    const count = input.installments ?? 1;
    const groupId = count > 1 ? randomUUID() : null;
    const schedule = buildInstallments(toCents(input.amount), count, input.dueDate);
    const created: Expense[] = [];

    await runSerializable(prisma, async (tx) => {
      await assertTenantRefs(tx, companyId, input.categoryId, input.supplierId);
      for (const row of schedule) {
        created.push(
          await tx.expense.create({
            data: {
              companyId,
              description: input.description,
              category: input.category,
              amount: fromCents(row.amountCents).toNumber(),
              dueDate: row.dueDate,
              notes: input.notes,
              categoryId: input.categoryId,
              supplierId: input.supplierId,
              installmentGroupId: groupId,
              installmentNumber: count > 1 ? row.installmentNumber : null,
              installmentTotal: count > 1 ? row.installmentTotal : null,
              recurrenceInterval: input.recurrenceInterval ?? null,
              recurrenceEndsAt: input.recurrenceEndsAt ?? null,
            },
          })
        );
      }
    });

    return created.map((expense) => this.present(expense));
  }

  async list(companyId: string, params: ListParams, filters: ListPayablesFilters = {}) {
    const where: Prisma.ExpenseWhereInput = { companyId };
    if (filters.isPaid !== undefined) where.isPaid = filters.isPaid;

    const all = await prisma.expense.findMany({ where, orderBy: orderBy(params) });

    // Status derivado depende de fuso; filtrar em memória mantém uma única
    // definição de "vencido". Trade-off: varredura completa do tenant por
    // página — aceitável no F1, revisar quando o volume crescer.
    let presented = all.map((expense) => this.present(expense));
    if (filters.status) presented = presented.filter((item) => item.status === filters.status);
    const filteredTotal = presented.length;
    const start = (params.page - 1) * params.limit;

    return {
      items: presented.slice(start, start + params.limit),
      pagination: buildPagination(params.page, params.limit, filteredTotal),
    };
  }

  async getById(id: string, companyId: string): Promise<PresentedExpense> {
    const expense = await prisma.expense.findFirst({ where: { id, companyId } });
    if (!expense) throw new AppError('Conta a pagar não encontrada', 404, 'PAYABLE_NOT_FOUND');
    return this.present(expense);
  }

  /** P6: paga E conciliada só permite mexer em amount/paidAt após desconciliação. */
  async update(id: string, input: UpdatePayableInput, companyId: string): Promise<PresentedExpense> {
    return runSerializable(prisma, async (tx) => {
      const expense = await tx.expense.findFirst({ where: { id, companyId } });
      if (!expense) throw new AppError('Conta a pagar não encontrada', 404, 'PAYABLE_NOT_FOUND');
      if (expense.canceledAt) {
        throw new AppError('Conta cancelada não pode ser alterada', 409, 'PAYABLE_CANCELED');
      }
      await assertTenantRefs(tx, companyId, input.categoryId, input.supplierId);
      if (
        expense.isPaid &&
        expense.isReconciled &&
        (input.amount !== undefined || input.paidAt !== undefined)
      ) {
        throw new AppError(
          'Despesa conciliada: desfaça a conciliação antes de alterar valor ou pagamento',
          409,
          'EXPENSE_RECONCILED'
        );
      }

      const updated = await tx.expense.update({
        where: { id: expense.id },
        data: {
          description: input.description,
          category: input.category,
          amount: input.amount,
          dueDate: input.dueDate,
          paidDate: input.paidAt,
          notes: input.notes,
          categoryId: input.categoryId,
          supplierId: input.supplierId,
        },
      });
      return this.present(updated);
    });
  }

  /** P1/P2/P3/P8: baixa + movimento de caixa na MESMA transação; idempotente. */
  async pay(
    id: string,
    input: PayPayableInput,
    companyId: string,
    userId: string
  ): Promise<PresentedExpense> {
    return runSerializable(prisma, async (tx) => {
      const expense = await tx.expense.findFirst({ where: { id, companyId } });
      if (!expense) throw new AppError('Conta a pagar não encontrada', 404, 'PAYABLE_NOT_FOUND');
      if (expense.canceledAt) {
        throw new AppError('Conta cancelada não pode ser paga', 409, 'PAYABLE_CANCELED');
      }
      if (expense.isPaid) return this.present(expense);

      // Fronteira única de dinheiro (money.ts): HALF_UP para centavos antes de
      // gravar em Decimal(14,2) e em CashMovement.amount (Float). Sem isto,
      // 3 casas decimais são arredondadas pelo banco e o movimento diverge.
      const paidCents = toCents(input.paidAmount ?? expense.amount);
      if (paidCents <= 0) {
        throw new AppError(
          'paidAmount deve resultar em pelo menos um centavo',
          422,
          'INVALID_PAID_AMOUNT'
        );
      }
      const paidAmount = fromCents(paidCents);
      let bankAccountId: string | null = null;
      let sessionId: string | null = null;

      if (input.paymentMethod === 'CASH') {
        sessionId = (await resolveOpenSession(tx, companyId, userId)).id;
      } else {
        if (!input.bankAccountId) {
          throw new AppError(
            'bankAccountId é obrigatório para pagamentos que não sejam em dinheiro',
            422,
            'BANK_ACCOUNT_REQUIRED'
          );
        }
        const account = await tx.bankAccount.findFirst({
          where: { id: input.bankAccountId, companyId },
          select: { id: true },
        });
        if (!account) {
          throw new AppError('Conta bancária não encontrada', 404, 'BANK_ACCOUNT_NOT_FOUND');
        }
        bankAccountId = account.id;
      }

      const updated = await tx.expense.update({
        where: { id: expense.id },
        data: {
          isPaid: true,
          paidDate: input.paidAt,
          paidAmount,
          paymentMethod: input.paymentMethod,
          bankAccountId,
        },
      });

      if (sessionId) {
        await tx.cashMovement.create({
          data: {
            companyId,
            sessionId,
            type: 'EXPENSE',
            direction: 'OUT',
            amount: paidAmount.toNumber(),
            description: `Pagamento de ${expense.description}`,
            expenseId: expense.id,
            createdById: userId,
          },
        });
      }

      return this.present(updated);
    });
  }

  /** P7: cancelar só se não paga e não conciliada. */
  async cancel(id: string, companyId: string): Promise<PresentedExpense> {
    return runSerializable(prisma, async (tx) => {
      const expense = await tx.expense.findFirst({ where: { id, companyId } });
      if (!expense) throw new AppError('Conta a pagar não encontrada', 404, 'PAYABLE_NOT_FOUND');
      if (expense.isPaid || expense.isReconciled) {
        throw new AppError('Conta paga ou conciliada não pode ser cancelada', 409, 'PAYABLE_PAID_OR_RECONCILED');
      }
      if (expense.canceledAt) return this.present(expense);

      const updated = await tx.expense.update({
        where: { id: expense.id },
        data: { canceledAt: new Date() },
      });
      return this.present(updated);
    });
  }

  async remove(id: string, companyId: string): Promise<{ id: string }> {
    return runSerializable(prisma, async (tx) => {
      const expense = await tx.expense.findFirst({ where: { id, companyId } });
      if (!expense) throw new AppError('Conta a pagar não encontrada', 404, 'PAYABLE_NOT_FOUND');
      if (expense.isPaid || expense.isReconciled) {
        throw new AppError('Conta paga ou conciliada não pode ser excluída', 409, 'PAYABLE_PAID_OR_RECONCILED');
      }
      await tx.expense.delete({ where: { id: expense.id } });
      return { id: expense.id };
    });
  }

  /**
   * P5 — reutilizada pelo job F1.7 (mesmo gerador, sem reimplementação).
   * `createMany(skipDuplicates)` + `@@unique([recurrenceParentId, dueDate])`
   * tornam duas execuções idempotentes. Retorna quantas linhas foram criadas.
   */
  async generateOccurrences(companyId: string, parentId: string, now = new Date()): Promise<number> {
    const parent = await prisma.expense.findFirst({ where: { id: parentId, companyId } });
    if (!parent) throw new AppError('Conta a pagar não encontrada', 404, 'PAYABLE_NOT_FOUND');
    // Modelo cancelado não gera parcelas futuras — o job F1.7 chama o gerador
    // para todos os recorrentes e não deve ressuscitar uma série cancelada.
    if (parent.canceledAt) return 0;
    if (!parent.recurrenceInterval) {
      throw new AppError('Conta não é recorrente', 422, 'PAYABLE_NOT_RECURRING');
    }

    const base = parent.dueDate.getTime() > now.getTime() ? parent.dueDate : now;
    const until = threeMonthsFrom(base);
    const horizon =
      parent.recurrenceEndsAt && parent.recurrenceEndsAt.getTime() < until.getTime()
        ? parent.recurrenceEndsAt
        : until;
    const dates = buildRecurrenceDates(parent.dueDate, parent.recurrenceInterval, base, horizon);
    if (dates.length === 0) return 0;

    const result = await prisma.expense.createMany({
      data: dates.map((dueDate) => ({
        companyId,
        description: parent.description,
        category: parent.category,
        amount: parent.amount,
        dueDate,
        notes: parent.notes,
        categoryId: parent.categoryId,
        supplierId: parent.supplierId,
        recurrenceParentId: parent.id,
        recurrenceInterval: null,
        isRecurring: true,
        source: EntrySource.RECURRING,
      })),
      skipDuplicates: true,
    });
    return result.count;
  }
}

export const payablesService = new PayablesService();
