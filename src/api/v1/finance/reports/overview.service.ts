/**
 * [F1.6] GET /finance/overview — spec:1142-1153.
 *
 * Busca tudo com `companyId` do usuário recarregado do banco. Regras de
 * negócio ficam no módulo puro `domain/finance/reports/overview`; aqui só
 * converto as entidades e reutilizo as regras já existentes de saldo (I10)
 * e de total de caixa (C1-C9) — nunca reimplemento nenhuma das duas.
 */
import prisma from '../../../../config/db';
import { computeTotals } from '../../../../domain/finance/cash/closing';
import { fromCents, toApi, toCents } from '../../../../domain/finance/money';
import {
  buildAlerts,
  OverviewCardReceivable,
  OverviewCashSession,
  OverviewExpense,
  OverviewOtherIncome,
  OverviewPayment,
  sumFlows,
  sumPayables,
  sumReceivables,
} from '../../../../domain/finance/reports/overview';
import { bankAccountsService } from '../bank-accounts/bank-accounts.service';

export class OverviewService {
  async get(companyId: string, from: Date, to: Date, now = new Date()) {
    const [accounts, expenses, payments, incomes, cards, sessions] = await Promise.all([
      prisma.bankAccount.findMany({ where: { companyId }, orderBy: { name: 'asc' } }),
      prisma.expense.findMany({ where: { companyId } }),
      prisma.payment.findMany({ where: { companyId } }),
      prisma.otherIncome.findMany({
        where: { companyId, receivedAt: { gte: from, lte: to } },
      }),
      prisma.cardReceivable.findMany({ where: { companyId } }),
      prisma.cashSession.findMany({
        where: { companyId, status: 'OPEN' },
        include: { register: true, movements: true },
        orderBy: { openedAt: 'desc' },
      }),
    ]);

    const cardPaymentIds = new Set(cards.map((c) => c.paymentId));

    const payables: OverviewExpense[] = expenses.map((e) => ({
      amount: e.amount,
      dueDate: e.dueDate,
      isPaid: e.isPaid,
      canceledAt: e.canceledAt,
      paidDate: e.paidDate,
    }));
    const paymentRows: OverviewPayment[] = payments.map((p) => ({
      amount: p.amount,
      status: p.status,
      paidAt: p.paidAt,
      canceledAt: p.canceledAt,
      hasCardReceivable: cardPaymentIds.has(p.id),
    }));
    const incomeRows: OverviewOtherIncome[] = incomes.map((i) => ({
      amount: toApi(i.amount),
      receivedAt: i.receivedAt,
    }));
    const cardRows: OverviewCardReceivable[] = cards.map((c) => ({
      amount: c.grossAmount.toNumber(),
      expectedDate: c.expectedDate,
      isReconciled: c.isReconciled,
    }));
    const sessionRows: OverviewCashSession[] = sessions.map((s) => ({
      openedAt: s.openedAt,
      expectedCash: null, // preenchido abaixo pelo total C1-C9 da sessão aberta
    }));

    // Reutiliza I10 e o cálculo puro C1-C9 sobre a própria sessão carregada.
    const balances = await Promise.all(
      accounts.map(async (a) => {
        const balance = await bankAccountsService.balance(companyId, a.id, to.toISOString());
        return {
          id: a.id,
          name: a.name,
          ...balance,
          balance: toApi(balance.balance),
          initialBalance: toApi(balance.initialBalance),
        };
      })
    );
    const cashTotals = sessions.map((s) => {
      const totals = computeTotals(
        toCents(s.openingBalance),
        s.movements.map((m) => ({
          direction: m.direction === 'IN' ? 'IN' : 'OUT',
          cents: toCents(m.amount),
          voided: Boolean(m.voidedAt),
        }))
      );
      return { sessionId: s.id, registerName: s.register.name, totals };
    });
    cashTotals.forEach((c, idx) => {
      sessionRows[idx].expectedCash = toApi(fromCents(c.totals.expected));
    });

    return {
      bankBalances: {
        accounts: balances,
        total: toApi(fromCents(balances.reduce((sum, b) => sum + toCents(b.balance), 0))),
      },
      cash: {
        status: sessions.length ? 'OPEN' : 'CLOSED',
        sessions: cashTotals.map((c, idx) => ({
          id: c.sessionId,
          registerName: c.registerName,
          openedAt: sessionRows[idx].openedAt,
          expectedCash: sessionRows[idx].expectedCash,
        })),
      },
      payables: sumPayables(payables, now),
      receivables: sumReceivables(cardRows, paymentRows, now),
      flows: { from, to, ...sumFlows(paymentRows, incomeRows, payables, from, to) },
      alerts: buildAlerts(payables, cardRows, sessionRows, now),
    };
  }
}

export const overviewService = new OverviewService();
