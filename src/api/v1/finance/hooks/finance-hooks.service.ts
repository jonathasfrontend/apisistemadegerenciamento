/**
 * [F1.3] Hooks transacionais de pagamento — spec:1041-1056.
 * Toda escrita acontece dentro da MESMA transação do PaymentsService.
 * `companyId`/`userId` sempre vêm de `req.user` recarregado do banco.
 */
import {
  CashDirection,
  CashMovementType,
  CashSessionStatus,
  Payment,
  PaymentMethod,
  Prisma,
} from '@prisma/client';
import { AppError } from '../../../../middlewares/error.handler';
import { fromCents, toCents } from '../../../../domain/finance/money';
import { buildCardReceivables } from '../../../../domain/finance/reconciliation/card-settlement';
import type {
  PaymentConfirmedPayload,
  PaymentRefundedPayload,
} from '../../../../events/finance.events';

type Tx = Prisma.TransactionClient;

const CARD_METHODS: PaymentMethod[] = ['CREDIT', 'DEBIT'];
const WALLET_METHODS: PaymentMethod[] = ['PIX', 'LINK', 'WALLET'];

function rate(value: Prisma.Decimal | number | null | undefined): number {
  if (value == null) return 0;
  return typeof value === 'number' ? value : value.toNumber();
}

function installmentRates(value: Prisma.JsonValue | null): Record<string, number> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value)) {
    const parsed = typeof raw === 'number' ? raw : Number(raw);
    if (Number.isFinite(parsed)) out[key] = parsed;
  }
  return Object.keys(out).length ? out : null;
}

/** Ordem da spec:1044 — sessão OPEN do usuário → única OPEN da empresa → null. */
async function resolveCashSession(tx: Tx, companyId: string, userId?: string) {
  if (userId) {
    const own = await tx.cashSession.findFirst({
      where: { companyId, status: CashSessionStatus.OPEN, openedById: userId },
      orderBy: { openedAt: 'desc' },
    });
    if (own) return own;
  }
  return tx.cashSession.findFirst({
    where: { companyId, status: CashSessionStatus.OPEN },
    orderBy: { openedAt: 'desc' },
  });
}

async function requireOpenSession(tx: Tx, companyId: string, userId?: string) {
  const session = await resolveCashSession(tx, companyId, userId);
  if (!session) {
    throw new AppError(
      'É necessário abrir um caixa antes de confirmar pagamento em dinheiro',
      409,
      'CASH_SESSION_REQUIRED'
    );
  }
  return session;
}

async function resolveAcquirer(tx: Tx, companyId: string, payment: Payment) {
  if (payment.acquirerId) {
    const linked = await tx.acquirer.findFirst({
      where: { id: payment.acquirerId, companyId },
    });
    if (linked) return linked;
  }
  const active = await tx.acquirer.findMany({ where: { companyId, isActive: true } });
  if (active.length !== 1) {
    throw new AppError(
      'Informe uma maquininha ativa para pagamentos com cartão',
      422,
      'ACQUIRER_REQUIRED'
    );
  }
  await tx.payment.update({
    where: { id: payment.id },
    data: { acquirerId: active[0].id },
  });
  return active[0];
}

export class FinanceHooksService {
  /** spec:1041-1054 — chamado dentro de PaymentsService.confirm/$transaction. */
  async onPaymentConfirmed(
    tx: Tx,
    payment: Payment,
    companyId: string,
    userId?: string
  ): Promise<PaymentConfirmedPayload> {
    const method = payment.method;

    if (CARD_METHODS.includes(method)) {
      const acquirer = await resolveAcquirer(tx, companyId, payment);
      const confirmedOn = payment.paidAt ?? new Date();
      const rows = buildCardReceivables(
        {
          method: method as 'CREDIT' | 'DEBIT',
          amountCents: toCents(payment.amount),
          installments: payment.installments,
          confirmedOn,
        },
        {
          debitRate: rate(acquirer.debitRate),
          creditRate: rate(acquirer.creditRate),
          creditInstallmentRate: acquirer.creditInstallmentRate
            ? rate(acquirer.creditInstallmentRate)
            : null,
          installmentRates: installmentRates(acquirer.installmentRates),
          settlementDaysDebit: acquirer.settlementDaysDebit,
          settlementDaysCredit: acquirer.settlementDaysCredit,
          anticipates: acquirer.anticipates,
        }
      );

      // Idempotência: se ${method} já gerou recebíveis, não duplica.
      const existing = await tx.cardReceivable.count({ where: { paymentId: payment.id } });
      if (existing === 0) {
        await tx.cardReceivable.createMany({
          data: rows.map((row) => ({
            companyId,
            paymentId: payment.id,
            acquirerId: acquirer.id,
            installmentNumber: row.installmentNumber,
            installmentTotal: row.installmentTotal,
            grossAmount: fromCents(row.grossCents),
            feeAmount: fromCents(row.feeCents),
            netAmount: fromCents(row.netCents),
            expectedDate: row.expectedDate,
            isReconciled: false,
          })),
        });
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            installments: rows.length,
            feeAmount: fromCents(rows.reduce((sum, r) => sum + r.feeCents, 0)),
            netAmount: fromCents(rows.reduce((sum, r) => sum + r.netCents, 0)),
          },
        });
      }
    } else if (method === 'CASH') {
      const settings = await tx.financeSettings.findUnique({ where: { companyId } });
      const requireSession = settings?.requireOpenCashSession ?? true;
      const session = requireSession
        ? await requireOpenSession(tx, companyId, userId)
        : await resolveCashSession(tx, companyId, userId);

      if (session) {
        await tx.payment.update({
          where: { id: payment.id },
          data: { cashSessionId: session.id },
        });
      }

      // CashMovement.sessionId é NOT NULL: sem sessão (config liberou caixa)
      // o pagamento é confirmado, mas não entra como movimento de caixa.
      const already = await tx.cashMovement.findFirst({ where: { paymentId: payment.id } });
      if (session && !already) {
        await tx.cashMovement.create({
          data: {
            companyId,
            sessionId: session.id,
            createdById: userId ?? '',
            paymentId: payment.id,
            type: CashMovementType.SALE,
            direction: CashDirection.IN,
            amount: fromCents(toCents(payment.amount)),
            description: 'Pagamento em dinheiro',
          },
        });
      }
    } else if (WALLET_METHODS.includes(method) && !payment.bankAccountId) {
      const active = await tx.bankAccount.findMany({ where: { companyId, isActive: true } });
      if (active.length === 1) {
        await tx.payment.update({
          where: { id: payment.id },
          data: { bankAccountId: active[0].id },
        });
      }
    }

    // O payload volta ao service, que emite DEPOIS do commit. Emitir aqui
    // publicaria eventos de transações abortadas (P2034 → retry publica 2×).
    return { paymentId: payment.id, companyId, method };
  }

  /** spec:1056 — estorno na mesma transação do refund. */
  async onPaymentRefunded(
    tx: Tx,
    payment: Payment,
    companyId: string,
    userId?: string
  ): Promise<PaymentRefundedPayload> {
    if (payment.method === 'CASH') {
      const original = await tx.cashMovement.findFirst({ where: { paymentId: payment.id } });
      if (original) {
        const session = await requireOpenSession(tx, companyId, userId);
        // CashMovement.paymentId é @unique e já pertence ao SALE original.
        // O estorno é rastreado pela description + paymentId no texto, sem
        // violar o unique nem apagar o histórico da entrada (spec:1056).
        const refundDescription = `Estorno de pagamento ${payment.id}`;
        const priorRefund = await tx.cashMovement.findFirst({
          where: { companyId, type: CashMovementType.REFUND, description: refundDescription },
        });
        if (!priorRefund) {
          await tx.cashMovement.create({
            data: {
              companyId,
              sessionId: session.id,
              createdById: userId ?? '',
              type: CashMovementType.REFUND,
              direction: CashDirection.OUT,
              amount: fromCents(toCents(payment.amount)),
              description: refundDescription,
            },
          });
        }
      }
    } else if (CARD_METHODS.includes(payment.method)) {
      const reconciled = await tx.cardReceivable.count({
        where: { paymentId: payment.id, isReconciled: true },
      });
      if (reconciled > 0) {
        throw new AppError(
          'Desfaça a conciliação dos recebíveis antes de estornar',
          409,
          'CARD_RECEIVABLE_RECONCILED'
        );
      }
      await tx.cardReceivable.deleteMany({ where: { paymentId: payment.id } });
      await tx.payment.update({
        where: { id: payment.id },
        data: { feeAmount: null, netAmount: null },
      });
    }

    return { paymentId: payment.id, companyId, method: payment.method };
  }
}

export const financeHooks = new FinanceHooksService();
