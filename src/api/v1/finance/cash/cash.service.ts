import {
  CashDirection,
  CashMovementType,
  CashSessionStatus,
  Prisma,
} from '@prisma/client';
import prisma from '../../../../config/db';
import { AppError } from '../../../../middlewares/error.handler';
import { fromCents, toCents } from '../../../../domain/finance/money';
import {
  computeClosing,
  computeTotals,
  summarizeByMethod,
  Mv,
} from '../../../../domain/finance/cash/closing';
import { buildPagination, ListParams, orderBy } from '../shared';

// ---------------------------------------------------------------------------
// F1.1c — caixas registrados
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// F1.2 — sessões de caixa (C1–C9)
// `companyId` e `userId` sempre vêm de req.user recarregado do banco.
// ---------------------------------------------------------------------------

export interface OpenSessionInput {
  registerId: string;
  openingBalance: number;
}

export interface AddMovementInput {
  type: CashMovementType;
  direction: CashDirection;
  amount: number;
  description?: string;
  categoryId?: string | null;
  bankAccountId?: string | null;
  paymentId?: string | null;
  expenseId?: string | null;
}

export interface CloseSessionInput {
  countedCash: number;
  closingNotes?: string;
}

export interface SessionFilters {
  status?: string;
  registerId?: string;
}

type MovementProjection = {
  direction: CashDirection;
  amount: Prisma.Decimal;
  voidedAt: Date | null;
};

const toMv = (movement: MovementProjection): Mv => ({
  direction: movement.direction === 'IN' ? 'IN' : 'OUT',
  cents: toCents(movement.amount),
  voided: Boolean(movement.voidedAt),
});

const CLOSED_MESSAGE = 'Sessão de caixa já fechada';

export class CashSessionsService {
  private async requireSession(companyId: string, id: string) {
    const session = await prisma.cashSession.findFirst({ where: { id, companyId } });
    if (!session) throw new AppError('Sessão de caixa não encontrada', 404);
    return session;
  }

  /** C1 — sessão única por caixa registrador. */
  async open(companyId: string, userId: string, input: OpenSessionInput) {
    const register = await prisma.cashRegister.findFirst({
      where: { id: input.registerId, companyId },
      select: { id: true, isActive: true },
    });
    if (!register) throw new AppError('Caixa registrador não encontrado', 404);
    if (!register.isActive) throw new AppError('Caixa registrador inativo', 422);

    const existing = await prisma.cashSession.findFirst({
      where: { companyId, registerId: register.id, status: CashSessionStatus.OPEN },
      select: { id: true },
    });
    if (existing) {
      throw new AppError(
        'Já existe sessão aberta neste caixa',
        409,
        'CASH_SESSION_ALREADY_OPEN'
      );
    }

    return prisma.cashSession.create({
      data: {
        companyId,
        registerId: register.id,
        openedById: userId,
        openingBalance: fromCents(toCents(input.openingBalance)),
      },
    });
  }

  /** Sessão aberta do caixa + totais parciais em centavos. */
  async current(companyId: string, registerId: string) {
    const session = await prisma.cashSession.findFirst({
      where: { companyId, registerId, status: CashSessionStatus.OPEN },
      include: { movements: true },
      orderBy: { openedAt: 'desc' },
    });
    if (!session) throw new AppError('Nenhuma sessão aberta neste caixa', 404);

    const totals = computeTotals(toCents(session.openingBalance), session.movements.map(toMv));
    // Movimentos não são devolvidos aqui: o detalhe completo fica em GET /:id.
    const { movements: _movements, ...rest } = session;
    void _movements;
    return { ...rest, totals };
  }

  /** C9 — operador comum vê só as próprias sessões; view-all vê todas. */
  async list(
    companyId: string,
    userId: string,
    params: ListParams,
    filters: SessionFilters,
    canViewAll: boolean
  ) {
    const where: Prisma.CashSessionWhereInput = {
      companyId,
      ...(canViewAll ? {} : { openedById: userId }),
      ...(filters.status
        ? { status: filters.status as CashSessionStatus }
        : {}),
      ...(filters.registerId ? { registerId: filters.registerId } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.cashSession.findMany({
        where,
        include: {
          register: { select: { id: true, name: true } },
          openedBy: { select: { id: true, name: true } },
        },
        orderBy: orderBy(params) as Prisma.CashSessionOrderByWithRelationInput,
        skip: (params.page - 1) * params.limit,
        take: params.limit,
      }),
      prisma.cashSession.count({ where }),
    ]);
    return { items, pagination: buildPagination(params.page, params.limit, total) };
  }

  async getById(companyId: string, id: string, userId: string, canViewAll: boolean) {
    const session = await prisma.cashSession.findFirst({
      where: {
        id,
        companyId,
        ...(canViewAll ? {} : { openedById: userId }),
      },
      include: {
        register: { select: { id: true, name: true } },
        openedBy: { select: { id: true, name: true } },
        closedBy: { select: { id: true, name: true } },
        movements: { orderBy: { occurredAt: 'asc' } },
      },
    });
    if (!session) throw new AppError('Sessão de caixa não encontrada', 404);

    const totals = computeTotals(toCents(session.openingBalance), session.movements.map(toMv));
    return { ...session, totals };
  }

  /** C2/C3 — movimentos só em sessão OPEN, valor positivo, descrição obrigatória. */
  async addMovement(
    companyId: string,
    userId: string,
    sessionId: string,
    input: AddMovementInput
  ) {
    const session = await this.requireSession(companyId, sessionId);
    if (session.status !== CashSessionStatus.OPEN) {
      throw new AppError(CLOSED_MESSAGE, 409, 'CASH_SESSION_CLOSED');
    }

    const amountCents = toCents(input.amount);
    if (amountCents <= 0) throw new AppError('Valor deve ser maior que zero', 400);
    const description = (input.description ?? '').trim();
    if (!description) throw new AppError('Descrição é obrigatória', 400);

    if (input.bankAccountId) {
      const bankAccount = await prisma.bankAccount.findFirst({
        where: { id: input.bankAccountId, companyId },
        select: { id: true },
      });
      if (!bankAccount) throw new AppError('Conta bancária não encontrada', 400);
    }

    return prisma.cashMovement.create({
      data: {
        companyId,
        sessionId: session.id,
        createdById: userId,
        type: input.type,
        direction: input.direction,
        amount: fromCents(amountCents),
        description,
        ...(input.categoryId ? { categoryId: input.categoryId } : {}),
        ...(input.bankAccountId ? { bankAccountId: input.bankAccountId } : {}),
        ...(input.paymentId ? { paymentId: input.paymentId } : {}),
        ...(input.expenseId ? { expenseId: input.expenseId } : {}),
      },
    });
  }

  /** C4 — estorno não apaga a linha; preenche auditoria do void. */
  async voidMovement(
    companyId: string,
    userId: string,
    sessionId: string,
    movementId: string,
    reason: string
  ) {
    const session = await this.requireSession(companyId, sessionId);
    if (session.status !== CashSessionStatus.OPEN) {
      throw new AppError(CLOSED_MESSAGE, 409, 'CASH_SESSION_CLOSED');
    }
    const movement = await prisma.cashMovement.findFirst({
      where: { id: movementId, sessionId: session.id, companyId },
    });
    if (!movement) throw new AppError('Movimento não encontrado', 404);
    if (movement.voidedAt) throw new AppError('Movimento já anulado', 409, 'MOVEMENT_ALREADY_VOIDED');

    const trimmedReason = (reason ?? '').trim();
    if (!trimmedReason) throw new AppError('Motivo do estorno é obrigatório', 400);

    return prisma.cashMovement.update({
      where: { id: movement.id },
      data: { voidedAt: new Date(), voidedById: userId, voidReason: trimmedReason },
    });
  }

  /** C5/C6/C7 — expected/difference por centavos, tolerância e resumo. */
  async close(companyId: string, userId: string, sessionId: string, input: CloseSessionInput) {
    const session = await prisma.cashSession.findFirst({
      where: { id: sessionId, companyId },
      include: { movements: true, payments: true },
    });
    if (!session) throw new AppError('Sessão de caixa não encontrada', 404);
    if (session.status !== CashSessionStatus.OPEN) {
      throw new AppError(CLOSED_MESSAGE, 409, 'CASH_SESSION_CLOSED');
    }

    const countedCents = toCents(input.countedCash);
    const closing = computeClosing(
      toCents(session.openingBalance),
      session.movements.map(toMv),
      countedCents
    );

    const settings = await prisma.financeSettings.findUnique({ where: { companyId } });
    const toleranceCents = settings ? toCents(settings.cashClosingTolerance) : 0;
    if (Math.abs(closing.difference) > toleranceCents && !input.closingNotes?.trim()) {
      throw new AppError(
        'Notas de fechamento são obrigatórias quando há diferença',
        422,
        'CLOSING_NOTES_REQUIRED'
      );
    }

    const byType: Record<string, number> = {};
    for (const movement of session.movements) {
      if (movement.voidedAt) continue;
      byType[movement.type] = (byType[movement.type] ?? 0) + toCents(movement.amount);
    }

    const summary = {
      byType,
      byMethod: summarizeByMethod(session.payments),
      totals: { ...closing, counted: countedCents, tolerance: toleranceCents },
    };

    return prisma.cashSession.update({
      where: { id: session.id },
      data: {
        status: CashSessionStatus.CLOSED,
        closedById: userId,
        closedAt: new Date(),
        expectedCash: fromCents(closing.expected),
        countedCash: fromCents(countedCents),
        difference: fromCents(closing.difference),
        closingNotes: input.closingNotes?.trim() || null,
        summary: summary as Prisma.InputJsonValue,
      },
    });
  }

  /** C8 — reabertura auditada, restrita a CLOSED. */
  async reopen(companyId: string, userId: string, sessionId: string, reason: string) {
    const session = await this.requireSession(companyId, sessionId);
    if (session.status !== CashSessionStatus.CLOSED) {
      throw new AppError('A sessão não está fechada', 409, 'CASH_SESSION_NOT_CLOSED');
    }
    const trimmedReason = (reason ?? '').trim();
    if (!trimmedReason) throw new AppError('Motivo da reabertura é obrigatório', 400);

    const [updated] = await prisma.$transaction([
      prisma.cashSession.update({
        where: { id: session.id },
        data: {
          status: CashSessionStatus.OPEN,
          closedById: null,
          closedAt: null,
          expectedCash: null,
          countedCash: null,
          difference: null,
          closingNotes: null,
          summary: Prisma.JsonNull,
        },
      }),
      prisma.auditLog.create({
        data: {
          companyId,
          userId,
          action: 'CASH_REOPEN',
          entity: 'cash_session',
          entityId: session.id,
          payload: { reason: trimmedReason } as Prisma.InputJsonValue,
        },
      }),
    ]);
    return updated;
  }
}

export const cashSessionsService = new CashSessionsService();
