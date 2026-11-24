/**
 * [F1.5] Visão unificada de a receber: Payment + OtherIncome.
 *
 * `companyId` é sempre o do req.user recarregado (F0.2). Filtros em SQL onde
 * possível; expectedDate e status derivados pela projeção pura (project.ts).
 * Resumo calculado sobre TODA a lista filtrada, antes da paginação (D-F1.45).
 */
import prisma from '../../../../config/db';
import {
  projectOtherIncome,
  projectPayment,
  summarizeReceivables,
  UnifiedReceivable,
  ReceivableMethod,
  ReceivableStatus,
} from '../../../../domain/finance/receivables/project';
import { buildPagination, Pagination } from '../shared';

export interface ReceivableQuery {
  page: number;
  limit: number;
  from?: Date;
  to?: Date;
  method?: ReceivableMethod;
  status?: ReceivableStatus;
  isReconciled?: boolean;
  acquirerId?: string;
  sortField: 'expectedDate' | 'amount' | 'status' | 'kind';
  sortDirection: 'asc' | 'desc';
}

export interface ReceivablesResult {
  items: UnifiedReceivable[];
  pagination: Pagination;
  summary: ReturnType<typeof summarizeReceivables>;
}

const METHODS: ReceivableMethod[] = ['CASH', 'DEBIT', 'CREDIT', 'PIX', 'LINK', 'WALLET'];
const STATUSES: ReceivableStatus[] = ['PENDING', 'PAID', 'OVERDUE', 'REFUNDED'];

function decimal(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  return Number(value);
}

export class ReceivablesService {
  async list(companyId: string, q: ReceivableQuery, now = new Date()): Promise<ReceivablesResult> {
    const dateRange = {
      ...(q.from ? { gte: q.from } : {}),
      ...(q.to ? { lte: q.to } : {}),
    };
    const [payments, incomes] = await Promise.all([
      prisma.payment.findMany({
        where: {
          companyId,
          ...(q.method ? { method: q.method } : {}),
          ...(q.isReconciled !== undefined ? { isReconciled: q.isReconciled } : {}),
          // Filtro amplo de período em SQL; a projeção afunila com a data derivada.
          // Cartão entra pelo expectedDate do recebível (spec:1136), não por paidAt.
          ...(q.from || q.to
            ? {
                OR: [
                  { paidAt: dateRange },
                  { createdAt: dateRange },
                  { cardReceivables: { some: { expectedDate: dateRange } } },
                ],
              }
            : {}),
        },
        select: {
          id: true,
          companyId: true,
          amount: true,
          method: true,
          status: true,
          isReconciled: true,
          canceledAt: true,
          paidAt: true,
          createdAt: true,
          feeAmount: true,
          netAmount: true,
          acquirerId: true,
          client: { select: { name: true } },
          cardReceivables: {
            select: {
              expectedDate: true,
              isReconciled: true,
              feeAmount: true,
              netAmount: true,
              acquirerId: true,
            },
          },
        },
      }),
      prisma.otherIncome.findMany({
        where: {
          companyId,
          ...(q.isReconciled !== undefined ? { isReconciled: q.isReconciled } : {}),
          ...(q.method ? { id: { in: [] } } : {}), // OtherIncome não tem método: excluído.
          ...(q.from || q.to
            ? {
                receivedAt: {
                  ...(q.from ? { gte: q.from } : {}),
                  ...(q.to ? { lte: q.to } : {}),
                },
              }
            : {}),
        },
        select: {
          id: true,
          description: true,
          amount: true,
          receivedAt: true,
          isReconciled: true,
        },
      }),
    ]);

    let rows: UnifiedReceivable[] = [
      ...payments.map((p) =>
        projectPayment(
          {
            id: p.id,
            companyId: p.companyId,
            amount: p.amount,
            method: p.method,
            status: p.status,
            isReconciled: p.isReconciled,
            canceledAt: p.canceledAt,
            paidAt: p.paidAt,
            createdAt: p.createdAt,
            feeAmount: decimal(p.feeAmount),
            netAmount: decimal(p.netAmount),
            acquirerId: p.acquirerId,
            clientName: p.client.name,
          },
          p.cardReceivables.map((r) => ({
            expectedDate: r.expectedDate,
            isReconciled: r.isReconciled,
            feeAmount: Number(r.feeAmount),
            netAmount: Number(r.netAmount),
            acquirerId: r.acquirerId,
          })),
          now
        )
      ),
      ...incomes.map((i) => projectOtherIncome({ ...i, amount: Number(i.amount) })),
    ];

    // Filtros que dependem da projeção (status derivado, data derivada, adquirente).
    rows = rows.filter((r) => {
      if (q.status && r.status !== q.status) return false;
      if (q.acquirerId && r.acquirerId !== q.acquirerId) return false;
      if (q.from && r.expectedDate.getTime() < q.from.getTime()) return false;
      if (q.to && r.expectedDate.getTime() > q.to.getTime()) return false;
      return true;
    });

    const dir = q.sortDirection === 'asc' ? 1 : -1;
    rows.sort((a, b) => {
      const av = a[q.sortField];
      const bv = b[q.sortField];
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      if (av instanceof Date && bv instanceof Date) return (av.getTime() - bv.getTime()) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });

    const summary = summarizeReceivables(rows);
    const total = rows.length;
    const start = (q.page - 1) * q.limit;
    return {
      items: rows.slice(start, start + q.limit),
      pagination: buildPagination(q.page, q.limit, total),
      summary,
    };
  }
}

export const receivablesService = new ReceivablesService();
export { METHODS as RECEIVABLE_METHODS, STATUSES as RECEIVABLE_STATUSES };
