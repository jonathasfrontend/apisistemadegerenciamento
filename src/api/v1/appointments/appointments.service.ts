import prisma from '../../../config/db';
import { AppError } from '../../../middlewares/error.handler';
import { notifyResource, notifyRoles } from '../notifications/notifications.service';
import { NotificationType, AppointmentStatus } from '@prisma/client';
import { formatDateTime } from '../../../utils/format';
import {
  paymentPaidMessage,
  paymentPendingMessage,
} from '../payments/payment-messages';
import { scheduleAppointmentStart } from '../../../jobs/appointment-start';

/**
 * Status a partir dos quais cancelamento/falta ainda fazem sentido.
 * Fora daqui a transição é recusada (400): um appointment já CANCELLED ou
 * NO_SHOW não pode virar o outro, e COMPLETED é histórico.
 */
const ACTIVE_STATUSES: AppointmentStatus[] = ['SCHEDULED', 'CONFIRMED'];

type AppointmentWhereInput = {
  companyId?: string;
  staffId?: string;
  clientId?: string;
  status?: any;
  startTime?: {
    gte?: Date;
    lte?: Date;
    lt?: Date;
    gt?: Date;
  };
  OR?: Array<{
    AND?: Array<{
      startTime?: { lte?: Date; lt?: Date; gte?: Date };
      endTime?: { gt?: Date; gte?: Date; lte?: Date };
    }>;
  }>;
  id?: { not?: string };
};

interface CreateAppointmentInput {
  clientId: string;
  staffId: string;
  startTime: Date;
  services: Array<{
    id: string;
    name: string;
    price: number;
    duration: number;
  }>;
  notes?: string;
}

interface UpdateAppointmentInput {
  staffId?: string;
  startTime?: Date;
  status?: string;
  notes?: string;
  isPaid?: boolean;
}

export class AppointmentService {
  async create(data: CreateAppointmentInput, createdBy: string, companyId: string) {
    // Validate client exists
    const client = await prisma.client.findFirst({
      where: { id: data.clientId, companyId },
    });

    if (!client) {
      throw new AppError('Client not found', 404);
    }

    if (client.isBlocked) {
      throw new AppError('Client is blocked due to no-shows', 400);
    }

    // Validate staff exists
    const staff = await prisma.staff.findFirst({
      where: { id: data.staffId, companyId },
    });

    if (!staff || !staff.isAvailable) {
      throw new AppError('Staff not available', 400);
    }

    // Calculate total duration and amount
    const totalDuration = data.services.reduce((sum, s) => sum + s.duration, 0);
    const totalAmount = data.services.reduce((sum, s) => sum + s.price, 0);

    const endTime = new Date(data.startTime);
    endTime.setMinutes(endTime.getMinutes() + totalDuration);

    // Check for conflicts
    const hasConflict = await this.checkConflict(
      data.staffId,
      data.startTime,
      endTime,
      undefined,
      companyId
    );

    if (hasConflict) {
      throw new AppError('Time slot not available', 400);
    }

    // Create appointment with payment in a transaction
    const appointment = await prisma.$transaction(async (tx : any) => {
      // Create the appointment
      const newAppointment = await tx.appointment.create({
        data: {
          companyId,
          clientId: data.clientId,
          staffId: data.staffId,
          startTime: data.startTime,
          endTime,
          services: data.services,
          totalAmount,
          notes: data.notes,
          createdBy,
        },
      });

      // Create the payment automatically with PENDING status.
      // companyId vem do contexto autenticado (req.user), nunca do body —
      // payments.companyId é NOT NULL desde a migration F0.
      await tx.payment.create({
        data: {
          companyId,
          appointmentId: newAppointment.id,
          clientId: data.clientId,
          amount: totalAmount,
          method: 'CASH', // Default method, can be changed later
          status: 'PENDING',
        },
      });

      // Return appointment with relations
      return tx.appointment.findUnique({
        where: { id: newAppointment.id },
        include: {
          client: true,
          staff: {
            include: {
              user: {
                select: { name: true, phone: true },
              },
            },
          },
          payments: {
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      });
    });

    // Notificação in-app (best-effort — notifyRoles nunca propaga erro)
    await notifyRoles(['Admin', 'Recepção'], {
      type: NotificationType.CONFIRMATION,
      message: `Novo agendamento: ${client.name} em ${formatDateTime(appointment.startTime)}`,
      appointmentId: appointment.id,
      link: `/appointments/${appointment.id}`,
    }, companyId);

    // Aviso "começando agora" no horário exato (BullMQ + reconciliador)
    await scheduleAppointmentStart({
      id: appointment.id,
      startTime: appointment.startTime,
      client: { name: client.name },
      staff: { userId: appointment.staff.userId },
      companyId,
    });

    return appointment;
  }

  async findAll(params: {
    page?: number;
    limit?: number;
    staffId?: string;
    clientId?: string;
    status?: string;
    date?: string;
    startDate?: string;
    endDate?: string;
  }, companyId: string) {
    const { page = 1, limit = 50, staffId, clientId, status, date, startDate, endDate } = params;
    const skip = (page - 1) * limit;

    const where: AppointmentWhereInput = { companyId };

    if (staffId) {
      where.staffId = staffId;
    }

    if (clientId) {
      where.clientId = clientId;
    }

    if (status) {
      where.status = status as any;
    }

    // Filter by specific date
    if (date && !startDate && !endDate) {
      // Ajustar para fuso horário do Brasil (UTC-3)
      const dateStr = date.includes('T') ? date.split('T')[0] : date;
      
      // Início do dia em horário local BR (00:00 BR = 03:00 UTC)
      const startOfDay = new Date(`${dateStr}T03:00:00.000Z`);
      
      // Fim do dia em horário local BR (23:59 BR = 02:59 UTC do dia seguinte)
      const nextDay = new Date(startOfDay);
      nextDay.setDate(nextDay.getDate() + 1);
      const endOfDay = new Date(nextDay.getTime() - 1); // 02:59:59.999Z
      
      where.startTime = {
        gte: startOfDay,
        lte: endOfDay,
      };
    }
    // Filter by date range
    else if (startDate && endDate) {
      // Validar formato de data
      const startStr = startDate.includes('T') ? startDate.split('T')[0] : startDate;
      const endStr = endDate.includes('T') ? endDate.split('T')[0] : endDate;
      
      // Ajustar para fuso horário do Brasil (UTC-3)
      const start = new Date(`${startStr}T03:00:00.000Z`);
      
      // Fim do último dia no range
      const endDate_parsed = new Date(`${endStr}T03:00:00.000Z`);
      endDate_parsed.setDate(endDate_parsed.getDate() + 1);
      const end = new Date(endDate_parsed.getTime() - 1); // 02:59:59.999Z
      
      // Validar se as datas são válidas
      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        throw new AppError('Invalid date format. Use YYYY-MM-DD format', 400);
      }
      
      where.startTime = {
        gte: start,
        lte: end,
      };
    }

    const [appointments, total] = await Promise.all([
      prisma.appointment.findMany({
        where,
        skip,
        take: limit,
        orderBy: { startTime: 'asc' },
        include: {
          client: {
            select: {
              id: true,
              name: true,
              phone: true,
            },
          },
          staff: {
            include: {
              user: {
                select: { name: true },
              },
            },
          },
          payments: {
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      }),
      prisma.appointment.count({ where }),
    ]);

    return {
      data: appointments,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findById(id: string, companyId: string) {
    const appointment = await prisma.appointment.findFirst({
      where: { id, companyId },
      include: {
        client: true,
        staff: {
          include: {
            user: {
              select: { name: true, phone: true },
            },
          },
        },
        payments: true,
      },
    });

    if (!appointment) {
      throw new AppError('Appointment not found', 404);
    }

    return appointment;
  }

  async update(id: string, data: UpdateAppointmentInput, companyId: string) {
    const appointment = await prisma.appointment.findFirst({
      where: { id, companyId },
    });

    if (!appointment) {
      throw new AppError('Appointment not found', 404);
    }

    // Check if rescheduling
    if (data.startTime || data.staffId) {
      // Novo profissional precisa pertencer ao tenant antes de qualquer escrita.
      if (data.staffId) {
        const targetStaff = await prisma.staff.findFirst({
          where: { id: data.staffId, companyId },
          select: { id: true },
        });
        if (!targetStaff) throw new AppError('Staff not found', 404);
      }

      const staffId = data.staffId || appointment.staffId;
      const startTime = data.startTime || appointment.startTime;
      const duration = (appointment.endTime.getTime() - appointment.startTime.getTime()) / 60000;
      
      const endTime = new Date(startTime);
      endTime.setMinutes(endTime.getMinutes() + duration);

      const hasConflict = await this.checkConflict(staffId, startTime, endTime, id, companyId);

      if (hasConflict) {
        throw new AppError('Time slot not available', 400);
      }

      // Calculate new end time if start time changed
      if (data.startTime) {
        const duration = (appointment.endTime.getTime() - appointment.startTime.getTime()) / 60000;
        const newEndTime = new Date(startTime);
        newEndTime.setMinutes(newEndTime.getMinutes() + duration);
        
        const updateData: any = { ...data, startTime, endTime: newEndTime };
        
        const updated = await prisma.appointment.update({
          where: { id },
          data: updateData,
          include: {
            client: true,
            staff: {
              include: {
                user: { select: { name: true } },
              },
            },
            payments: {
              orderBy: { createdAt: 'desc' },
              take: 1,
            },
          },
        });

        if (data.status === 'COMPLETED') {
          await this.notifyPaymentState(updated, companyId);
        }

        if (data.startTime) {
          // Remarcação: reagenda o aviso de horário (novo dedupeKey)
          await scheduleAppointmentStart({
            id: updated.id,
            startTime: updated.startTime,
            client: { name: updated.client.name },
            staff: { userId: updated.staff.userId },
            companyId,
          });
        }

        return updated;
      }
    }

    const updated = await prisma.appointment.update({
      where: { id },
      data: data as any,
      include: {
        client: true,
        staff: {
          include: {
            user: { select: { name: true } },
          },
        },
        payments: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    if (data.status === 'COMPLETED') {
      await this.notifyPaymentState(updated, companyId);
    }

    return updated;
  }

  /**
   * Avisa Admin + Recepção sobre a situação do pagamento quando o agendamento
   * é concluído: `PAYMENT_PENDING` (sem pagamento) ou `PAYMENT_PAID` (pago).
   * Best-effort — nunca derruba a atualização do agendamento.
   */
  private async notifyPaymentState(appointment: {
    id: string;
    startTime: Date;
    isPaid: boolean;
    client: { name: string };
    payments?: Array<{ status: string }>;
  }, companyId: string): Promise<void> {
    const paid =
      appointment.isPaid || (appointment.payments ?? []).some((p) => p.status === 'PAID');

    await notifyResource(
      {
        type: paid ? NotificationType.PAYMENT_PAID : NotificationType.PAYMENT_PENDING,
        message: paid
          ? paymentPaidMessage(appointment.client.name, appointment.startTime)
          : paymentPendingMessage(appointment.client.name, appointment.startTime),
        appointmentId: appointment.id,
        link: `/appointments/${appointment.id}`,
        dedupeKey: `${paid ? 'PAYMENT_PAID' : 'PAYMENT_PENDING'}:${appointment.id}`,
      },
      { roleNames: ['Admin', 'Recepção'] },
      companyId
    );
  }

  async cancel(id: string, companyId: string) {
    const appointment = await prisma.appointment.findFirst({
      where: { id, companyId },
      include: { payments: true },
    });

    if (!appointment) {
      throw new AppError('Appointment not found', 404);
    }

    // Cancelar duas vezes geraria notificação duplicada e re-cancelaria pagamentos
    if (appointment.status === 'CANCELLED') {
      throw new AppError('Appointment is already cancelled', 400);
    }

    // Use transaction to update both appointment and payment
    const result = await prisma.$transaction(async (tx : any) => {
      // Update condicional: só o primeiro cancelamento vence. O filtro de
      // status ATIVO impede que um appointment já CANCELLED ou NO_SHOW seja
      // cancelado (e vice-versa) — os dois efeitos não podem coexistir.
      const claimed = await tx.appointment.updateMany({
        where: { id, companyId, status: { in: ACTIVE_STATUSES } },
        data: { status: 'CANCELLED' },
      });

      if (claimed.count === 0) {
        // Perdemos a corrida ou o status não permite cancelamento
        const current = await tx.appointment.findUnique({
          where: { id },
          select: { status: true },
        });
        throw new AppError(
          current?.status === 'CANCELLED'
            ? 'Appointment is already cancelled'
            : `Appointment cannot be cancelled in status ${current?.status ?? 'UNKNOWN'}`,
          400
        );
      }

      const updatedAppointment = await tx.appointment.findUnique({
        where: { id },
        include: {
          client: true,
          staff: {
            include: {
              user: { select: { name: true } },
            },
          },
          payments: {
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      });

      // Cancel pending payments
      await tx.payment.updateMany({
        where: {
          companyId,
          appointmentId: id,
          status: { in: ['PENDING', 'PARTIAL'] },
        },
        data: { status: 'CANCELLED' },
      });

      return updatedAppointment;
    });

    // Notificação in-app de cancelamento (best-effort)
    await notifyRoles(['Admin', 'Recepção'], {
      type: NotificationType.CANCELLATION,
      message: `Agendamento cancelado: ${result.client.name} em ${formatDateTime(result.startTime)}`,
      appointmentId: result.id,
      link: `/appointments/${result.id}`,
    }, companyId);

    return result;
  }

  async markNoShow(id: string, companyId: string) {
    const appointment = await prisma.appointment.findFirst({
      where: { id, companyId },
      include: { client: true },
    });

    if (!appointment) {
      throw new AppError('Appointment not found', 404);
    }

    // Marcar falta duas vezes contaria a mesma ausência duas vezes
    if (appointment.status === 'NO_SHOW') {
      throw new AppError('Appointment is already marked as no-show', 400);
    }

    // Status + contador + bloqueio em UMA transação:
    // o bloqueio deriva do contador já atualizado (snapshot obsoleto causava
    // contagem dupla em chamadas concorrentes).
    const updated = await prisma.$transaction(async (tx: any) => {
      // Update condicional: só o primeiro no-show vence. O incremento do
      // contador acontece DEPOIS e apenas para quem reivindicou a transição.
      // Filtra por status ATIVO: appointment CANCELLED/COMPLETED não vira falta.
      const claimed = await tx.appointment.updateMany({
        where: { id, companyId, status: { in: ACTIVE_STATUSES } },
        data: { status: 'NO_SHOW' },
      });

      if (claimed.count === 0) {
        // Perdemos a corrida ou o status não permite falta
        const current = await tx.appointment.findUnique({
          where: { id },
          select: { status: true },
        });
        throw new AppError(
          current?.status === 'NO_SHOW'
            ? 'Appointment is already marked as no-show'
            : `Appointment cannot be marked as no-show in status ${current?.status ?? 'UNKNOWN'}`,
          400
        );
      }

      const updatedAppointment = await tx.appointment.findUnique({
        where: { id },
        include: { client: true },
      });

      const client = await tx.client.update({
        where: { id: appointment.clientId },
        data: {
          noShowCount: {
            increment: 1,
          },
        },
        select: { noShowCount: true, isBlocked: true },
      });

      // Auto-block if >= 3 no-shows (usa o contador já incrementado)
      if (client.noShowCount >= 3 && !client.isBlocked) {
        await tx.client.update({
          where: { id: appointment.clientId },
          data: { isBlocked: true },
        });
      }

      return updatedAppointment;
    });

    // Notificação in-app de falta (best-effort)
    await notifyRoles(['Admin', 'Recepção'], {
      type: NotificationType.NO_SHOW,
      message: `Falta registrada: ${appointment.client.name} em ${formatDateTime(appointment.startTime)}`,
      appointmentId: appointment.id,
      link: `/appointments/${appointment.id}`,
    }, companyId);

    return updated;
  }

  async checkAvailability(staffId: string, date: string, companyId: string) {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const appointments = await prisma.appointment.findMany({
      where: {
        companyId,
        staffId,
        startTime: {
          gte: startOfDay,
          lte: endOfDay,
        },
        status: {
          notIn: ['CANCELLED', 'NO_SHOW'],
        },
      },
      orderBy: { startTime: 'asc' },
    });

    return appointments;
  }

  private async checkConflict(
    staffId: string,
    startTime: Date,
    endTime: Date,
    excludeId: string | undefined,
    companyId: string
  ): Promise<boolean> {
    const where: AppointmentWhereInput = {
      companyId,
      staffId,
      status: {
        notIn: ['CANCELLED', 'NO_SHOW'],
      },
      OR: [
        {
          AND: [
            { startTime: { lte: startTime } },
            { endTime: { gt: startTime } },
          ],
        },
        {
          AND: [
            { startTime: { lt: endTime } },
            { endTime: { gte: endTime } },
          ],
        },
        {
          AND: [
            { startTime: { gte: startTime } },
            { endTime: { lte: endTime } },
          ],
        },
      ],
    };

    if (excludeId) {
      where.id = { not: excludeId };
    }

    const conflict = await prisma.appointment.findFirst({ where });

    return !!conflict;
  }

  async getStats(params: { staffId?: string; startDate: string; endDate: string }, companyId: string) {
    const { staffId, startDate, endDate } = params;

    const where: AppointmentWhereInput = {
      companyId,
      startTime: {
        gte: new Date(startDate),
        lte: new Date(endDate),
      },
    };

    if (staffId) {
      where.staffId = staffId;
    }

    const [total, completed, cancelled, noShow, totalRevenue] = await Promise.all([
      prisma.appointment.count({ where }),
      prisma.appointment.count({ where: { ...where, status: 'COMPLETED' } }),
      prisma.appointment.count({ where: { ...where, status: 'CANCELLED' } }),
      prisma.appointment.count({ where: { ...where, status: 'NO_SHOW' } }),
      prisma.appointment.aggregate({
        where: { ...where, status: 'COMPLETED', isPaid: true },
        _sum: { totalAmount: true },
      }),
    ]);

    return {
      total,
      completed,
      cancelled,
      noShow,
      totalRevenue: totalRevenue._sum.totalAmount || 0,
      completionRate: total > 0 ? (completed / total) * 100 : 0,
      noShowRate: total > 0 ? (noShow / total) * 100 : 0,
    };
  }
}
