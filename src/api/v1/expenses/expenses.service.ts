import { Expense } from '@prisma/client';
import { createPrismaClient } from '../../../config/db';
import { AppError } from '../../../middlewares/error.handler';

const prisma = createPrismaClient();

interface CreateExpenseDTO {
  description: string;
  category: string;
  amount: number;
  dueDate: Date;
  isRecurring?: boolean;
  notes?: string;
}

interface UpdateExpenseDTO {
  description?: string;
  category?: string;
  amount?: number;
  dueDate?: Date;
  isRecurring?: boolean;
  notes?: string;
}

interface ExpenseFilters {
  category?: string;
  isPaid?: boolean;
  dateRange?: {
    start?: Date;
    end?: Date;
  };
}

export class ExpensesService {
  async create(data: CreateExpenseDTO, companyId: string): Promise<Expense> {
    return await prisma.expense.create({
      data: {
        companyId,
        description: data.description,
        category: data.category,
        amount: data.amount,
        dueDate: data.dueDate,
        isRecurring: data.isRecurring || false,
        notes: data.notes,
      },
    });
  }

  async list(filters: ExpenseFilters = {}, companyId: string): Promise<Expense[]> {
    const where: any = { companyId };

    if (filters.category) {
      where.category = filters.category;
    }
    
    if (filters.isPaid !== undefined) {
      where.isPaid = filters.isPaid;
    }
    
    if (filters.dateRange) {
      where.dueDate = {};
      if (filters.dateRange.start) {
        where.dueDate.gte = filters.dateRange.start;
      }
      if (filters.dateRange.end) {
        where.dueDate.lte = filters.dateRange.end;
      }
    }

    return await prisma.expense.findMany({
      where,
      orderBy: {
        dueDate: 'asc',
      },
    });
  }

  async getById(id: string, companyId: string): Promise<Expense | null> {
    return await prisma.expense.findFirst({
      where: { id, companyId },
    });
  }

  async update(id: string, data: UpdateExpenseDTO, companyId: string): Promise<Expense> {
    await this.assertScoped(id, companyId);
    return await prisma.expense.update({
      where: { id },
      data,
    });
  }

  async markAsPaid(id: string, companyId: string): Promise<Expense> {
    await this.assertScoped(id, companyId);
    return await prisma.expense.update({
      where: { id },
      data: {
        isPaid: true,
        paidDate: new Date(),
      },
    });
  }

  async delete(id: string, companyId: string): Promise<Expense> {
    await this.assertScoped(id, companyId);
    return await prisma.expense.delete({
      where: { id },
    });
  }

  /** [F1.4] Visibilidade aberta para a fachada /payables; lógica inalterada. */
  async assertScoped(id: string, companyId: string): Promise<void> {
    const found = await prisma.expense.findFirst({ where: { id, companyId }, select: { id: true } });
    if (!found) throw new AppError('Expense not found', 404);
  }
}
