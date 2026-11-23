import { NotificationType, Payment, PaymentMethod, PaymentStatus } from '@prisma/client';
import { createPrismaClient } from '../../../config/db';
import { AppError } from '../../../middlewares/error.handler';
import { notifyResource } from '../notifications/notifications.service';
import { paymentPaidMessage } from './payment-messages';
import { financeHooks } from '../finance/hooks/finance-hooks.service';
import { financeEvents } from '../../../events/finance.events';
import { runSerializable } from '../../../utils/transaction';

const prisma = createPrismaClient();

interface CreatePaymentDTO {
  appointmentId?: string;
  clientId: string;
  amount: number;
  method: PaymentMethod;
  acquirerId?: string;
  gatewayReference?: string;
}

interface PaymentFilters {
  status?: string;
  method?: string;
  clientId?: string;
  dateRange?: {
    start?: Date;
    end?: Date;
  };
}

export class PaymentsService {
  /**
   * Criar um novo pagamento
   */
  async create(data: CreatePaymentDTO, companyId: string): Promise<Payment> {
    // Referências do body também são fronteira de tenant: a linha criada é
    // escopada, mas uma FK alheia would link o pagamento a outro empresa.
    const client = await prisma.client.findFirst({
      where: { id: data.clientId, companyId },
      select: { id: true },
    });
    if (!client) throw new AppError('Client not found', 404);

    if (data.appointmentId) {
      const appointment = await prisma.appointment.findFirst({
        where: { id: data.appointmentId, companyId },
        select: { id: true },
      });
      if (!appointment) throw new AppError('Appointment not found', 404);
    }

    // [F1.3] acquirerId do body é fronteira de tenant: referência alheia
    // linkaria o pagamento à maquininha de outra empresa.
    if (data.acquirerId) {
      const acquirer = await prisma.acquirer.findFirst({
        where: { id: data.acquirerId, companyId },
        select: { id: true },
      });
      if (!acquirer) throw new AppError('Acquirer not found', 404);
    }

    const payment = await prisma.payment.create({
      data: {
        // companyId depois do spread: valor do cliente nunca sobrescreve o contexto
        ...data,
        companyId,
        status: PaymentStatus.PENDING,
      },
      include: {
        client: {
          select: {
            id: true,
            name: true,
            phone: true,
            email: true,
          },
        },
        appointment: {
          select: {
            id: true,
            startTime: true,
            services: true,
          },
        },
      },
    });

    return payment;
  }

  /**
   * Listar pagamentos com filtros
   */
  async list(filters: PaymentFilters = {}, companyId: string): Promise<Payment[]> {
    const where: any = { companyId };

    if (filters.status) {
      where.status = filters.status as PaymentStatus;
    }
    
    if (filters.method) {
      where.method = filters.method as PaymentMethod;
    }
    
    if (filters.clientId) {
      where.clientId = filters.clientId;
    }
    
    if (filters.dateRange) {
      where.createdAt = {};
      if (filters.dateRange.start) {
        where.createdAt.gte = filters.dateRange.start;
      }
      if (filters.dateRange.end) {
        where.createdAt.lte = filters.dateRange.end;
      }
    }

    return await prisma.payment.findMany({
      where,
      include: {
        client: {
          select: {
            id: true,
            name: true,
            phone: true,
          },
        },
        appointment: {
          select: {
            id: true,
            startTime: true,
            services: true,
          },
        },
        commissions: {
          include: {
            staff: {
              include: {
                user: {
                  select: {
                    name: true,
                  },
                },
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  /**
   * Buscar pagamento por ID
   */
  async getById(id: string, companyId: string): Promise<Payment | null> {
    return await prisma.payment.findFirst({
      where: { id, companyId },
      include: {
        client: true,
        appointment: true,
        commissions: {
          include: {
            staff: {
              include: {
                user: true,
              },
            },
          },
        },
      },
    });
  }

  /**
   * Confirmar pagamento — hooks financeiros na MESMA transação; notificação
   * best-effort fora dela. `userId` é opcional só para chamadores legados:
   * o controller sempre passa `req.user!.id` recarregado do banco (F0.2).
   */
  async confirm(id: string, companyId: string, userId?: string): Promise<Payment> {
    const result = await runSerializable(prisma, async (tx) => {
      const scoped = await tx.payment.findFirst({
        where: { id, companyId },
        include: { appointment: { include: { client: true } } },
      });
      if (!scoped) throw new AppError('Payment not found', 404);

      // Idempotência: confirmar de novo não duplica movimento, comissão ou recebível.
      if (scoped.status === PaymentStatus.PAID) {
        return { payment: scoped, notification: null, event: null };
      }

      // Estado terminal: reativar um estorno sem movimento compensatório
      // desbalancearia o caixa (o SALE original já ocupa paymentId no unique).
      if (scoped.status === PaymentStatus.REFUNDED) {
        throw new AppError(
          'Não é possível confirmar um pagamento estornado',
          409,
          'PAYMENT_REFUNDED'
        );
      }

      const payment = await tx.payment.update({
        where: { id },
        data: { status: PaymentStatus.PAID, paidAt: new Date() },
        include: { appointment: { include: { client: true } } },
      });

      // F1.3 — tudo dentro da transação: movimento de caixa, recebíveis, vínculos.
      const event = await financeHooks.onPaymentConfirmed(tx, payment, companyId, userId);

      if (payment.appointmentId) {
        await tx.appointment.update({
          where: { id: payment.appointmentId },
          data: { isPaid: true },
        });

        const appointment = await tx.appointment.findUnique({
          where: { id: payment.appointmentId },
          include: { staff: true },
        });
        const commission = appointment
          ? await tx.commission.findFirst({ where: { paymentId: payment.id }, select: { id: true } })
          : null;

        if (appointment && !commission) {
          await tx.commission.create({
            data: {
              companyId,
              paymentId: payment.id,
              staffId: appointment.staffId,
              amount: this.calculateCommission(
                payment.amount,
                appointment.staff.commissionType,
                appointment.staff.commissionValue
              ),
            },
          });
        }
      }

      // Devolver o estado atualizado pelos hooks (cashSessionId, feeAmount, …).
      const fresh = await tx.payment.findUniqueOrThrow({
        where: { id },
        include: { appointment: { include: { client: true } } },
      });

      const notification =
        payment.appointmentId && payment.appointment
          ? {
              type: NotificationType.PAYMENT_PAID,
              message: paymentPaidMessage(
                payment.appointment.client.name,
                payment.appointment.startTime
              ),
              appointmentId: payment.appointmentId,
              link: `/appointments/${payment.appointmentId}`,
              dedupeKey: `PAYMENT_PAID:${payment.appointmentId}`,
            }
          : null;

      return { payment: fresh, notification, event };
    });

    // Fora da transação — notificação e evento são best-effort e não participam
    // do commit. Um P2034 com retry não publica evento de tentativa abortada.
    if (result.event) {
      financeEvents.emit('payment.confirmed', result.event);
    }
    if (result.notification) {
      await notifyResource(result.notification, { roleNames: ['Admin', 'Recepção'] }, companyId);
    }

    return result.payment;
  }

  /** Reembolsar pagamento — hook dentro da transação (spec:1056). */
  async refund(id: string, companyId: string, userId?: string): Promise<Payment> {
    const result = await runSerializable(prisma, async (tx) => {
      const scoped = await tx.payment.findFirst({ where: { id, companyId } });
      if (!scoped) throw new AppError('Payment not found', 404);
      if (scoped.status === PaymentStatus.REFUNDED) return { payment: scoped, event: null };

      const payment = await tx.payment.update({
        where: { id },
        data: { status: PaymentStatus.REFUNDED },
      });

      const event = await financeHooks.onPaymentRefunded(tx, payment, companyId, userId);

      if (payment.appointmentId) {
        await tx.appointment.update({
          where: { id: payment.appointmentId },
          data: { isPaid: false },
        });
      }

      await tx.commission.updateMany({
        where: { paymentId: id, companyId },
        data: { isPaid: false },
      });

      // O hook zerou feeAmount/netAmount: reler para a resposta não devolver
      // valores obsoletos do Payment lido antes dele.
      const fresh = await tx.payment.findUniqueOrThrow({ where: { id } });
      return { payment: fresh, event };
    });

    if (result.event) {
      financeEvents.emit('payment.refunded', result.event);
    }

    return result.payment;
  }

  /**
   * Gerar relatório de pagamentos
   */
  async generateReport(startDate: Date, endDate: Date, companyId: string) {
    const payments = await prisma.payment.findMany({
      where: {
        companyId,
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },
    });

    const total = payments.reduce((sum, p) => sum + p.amount, 0);
    const paid = payments.filter(p => p.status === PaymentStatus.PAID);
    const pending = payments.filter(p => p.status === PaymentStatus.PENDING);
    const refunded = payments.filter(p => p.status === PaymentStatus.REFUNDED);

    const byMethod = await prisma.payment.groupBy({
      by: ['method'],
      where: {
        companyId,
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
        status: PaymentStatus.PAID,
      },
      _sum: {
        amount: true,
      },
      _count: true,
    });

    return {
      period: {
        start: startDate,
        end: endDate,
      },
      summary: {
        total: total,
        totalPaid: paid.reduce((sum, p) => sum + p.amount, 0),
        totalPending: pending.reduce((sum, p) => sum + p.amount, 0),
        totalRefunded: refunded.reduce((sum, p) => sum + p.amount, 0),
        count: payments.length,
        countPaid: paid.length,
        countPending: pending.length,
        countRefunded: refunded.length,
      },
      byMethod: byMethod.map(m => ({
        method: m.method,
        total: m._sum.amount || 0,
        count: m._count,
      })),
    };
  }

  /**
   * Calcular comissão do profissional
   */
  private calculateCommission(amount: number, type: string, value: number): number {
    switch (type) {
      case 'PERCENT':
        return (amount * value) / 100;
      case 'FIXED':
        return value;
      case 'TABLE':
        // Implementar lógica de tabela se necessário
        return 0;
      default:
        return 0;
    }
  }
}
