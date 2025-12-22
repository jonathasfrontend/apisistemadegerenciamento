/**
 * EXEMPLO PRÁTICO: Como adicionar Redis no AppointmentService
 * 
 * Este arquivo mostra as mudanças necessárias no appointments.service.ts
 * para usar Redis (cache e filas).
 */

import prisma from '../../../config/db';
import { AppError } from '../../../middlewares/error.handler';
import { cacheService } from '../../../services/cache.service';
import { scheduleReminder, addNotificationJob } from '../../../jobs/queue';

export class AppointmentServiceWithRedis {
  
  /**
   * EXEMPLO 1: Criar appointment com notificação via fila
   */
  async create(data: CreateAppointmentInput, createdBy: string) {
    // Validações existentes...
    const client = await prisma.client.findUnique({
      where: { id: data.clientId },
    });

    if (!client) {
      throw new AppError('Client not found', 404);
    }

    const staff = await prisma.staff.findUnique({
      where: { id: data.staffId },
    });

    if (!staff || !staff.isAvailable) {
      throw new AppError('Staff not available', 400);
    }

    const totalDuration = data.services.reduce((sum, s) => sum + s.duration, 0);
    const totalAmount = data.services.reduce((sum, s) => sum + s.price, 0);
    const endTime = new Date(data.startTime);
    endTime.setMinutes(endTime.getMinutes() + totalDuration);

    // Criar appointment com payment
    const appointment = await prisma.$transaction(async (tx: any) => {
      const newAppointment = await tx.appointment.create({
        data: {
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

      await tx.payment.create({
        data: {
          appointmentId: newAppointment.id,
          clientId: data.clientId,
          amount: totalAmount,
          method: 'CASH',
          status: 'PENDING',
        },
      });

      // ✅ NOVO: Enviar confirmação imediata via fila
      await addNotificationJob({
        type: 'whatsapp',
        recipient: client.phone,
        message: `✅ Agendamento confirmado!\n\nData: ${data.startTime.toLocaleDateString('pt-BR')}\nHorário: ${data.startTime.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}\nProfissional: ${staff.user?.name || 'N/A'}\nValor: R$ ${totalAmount.toFixed(2)}`,
        appointmentId: newAppointment.id
      });

      // ✅ NOVO: Agendar lembrete 24h antes
      await scheduleReminder(
        newAppointment.id,
        client.phone,
        client.name,
        data.startTime,
        24 // horas antes
      );

      // ✅ NOVO: Agendar lembrete 2h antes
      await scheduleReminder(
        newAppointment.id,
        client.phone,
        client.name,
        data.startTime,
        2 // horas antes
      );

      // ✅ NOVO: Invalidar cache de appointments deste cliente
      await cacheService.invalidateEntity('appointments', data.clientId);

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

    return appointment;
  }

  /**
   * EXEMPLO 2: Listar appointments com cache
   */
  async findAll(params: {
    page?: number;
    limit?: number;
    staffId?: string;
    clientId?: string;
    status?: string;
    date?: string;
  }) {
    const { page = 1, limit = 50, staffId, clientId, status, date } = params;

    // ✅ NOVO: Criar chave de cache baseada nos parâmetros
    const cacheKey = `appointments:list:${JSON.stringify(params)}`;

    // ✅ NOVO: Buscar do cache ou executar query
    return await cacheService.getOrSet(
      cacheKey,
      async () => {
        const skip = (page - 1) * limit;
        const where: any = {};

        if (staffId) where.staffId = staffId;
        if (clientId) where.clientId = clientId;
        if (status) where.status = status;
        if (date) {
          const dateStr = date.includes('T') ? date.split('T')[0] : date;
          const startOfDay = new Date(`${dateStr}T03:00:00.000Z`);
          const nextDay = new Date(startOfDay);
          nextDay.setDate(nextDay.getDate() + 1);
          const endOfDay = new Date(nextDay.getTime() - 1);
          
          where.startTime = {
            gte: startOfDay,
            lte: endOfDay,
          };
        }

        const [appointments, total] = await Promise.all([
          prisma.appointment.findMany({
            where,
            skip,
            take: limit,
            include: {
              client: {
                select: {
                  id: true,
                  name: true,
                  phone: true,
                  email: true,
                },
              },
              staff: {
                include: {
                  user: {
                    select: {
                      name: true,
                      phone: true,
                    },
                  },
                },
              },
              payments: {
                orderBy: { createdAt: 'desc' },
                take: 1,
              },
            },
            orderBy: { startTime: 'desc' },
          }),
          prisma.appointment.count({ where }),
        ]);

        return {
          data: appointments,
          pagination: {
            total,
            page,
            limit,
            pages: Math.ceil(total / limit),
          },
        };
      },
      300 // cache por 5 minutos (dados mudam frequentemente)
    );
  }

  /**
   * EXEMPLO 3: Buscar appointment por ID com cache
   */
  async findById(id: string) {
    const cacheKey = `appointment:${id}`;

    return await cacheService.getOrSet(
      cacheKey,
      async () => {
        const appointment = await prisma.appointment.findUnique({
          where: { id },
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
            },
          },
        });

        if (!appointment) {
          throw new AppError('Appointment not found', 404);
        }

        return appointment;
      },
      600 // cache por 10 minutos
    );
  }

  /**
   * EXEMPLO 4: Atualizar appointment e invalidar cache
   */
  async update(id: string, data: UpdateAppointmentInput, updatedBy: string) {
    const existingAppointment = await this.findById(id);

    // Validações...
    if (data.staffId && data.staffId !== existingAppointment.staffId) {
      const staff = await prisma.staff.findUnique({
        where: { id: data.staffId },
      });

      if (!staff || !staff.isAvailable) {
        throw new AppError('Staff not available', 400);
      }
    }

    const appointment = await prisma.appointment.update({
      where: { id },
      data: {
        ...data,
        updatedBy,
      },
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

    // ✅ NOVO: Invalidar caches relacionados
    await Promise.all([
      cacheService.del(`appointment:${id}`),
      cacheService.invalidateEntity('appointments', appointment.clientId),
      cacheService.invalidateEntity('appointments', appointment.staffId),
    ]);

    // ✅ NOVO: Notificar mudanças se necessário
    if (data.startTime && data.startTime !== existingAppointment.startTime) {
      await addNotificationJob({
        type: 'whatsapp',
        recipient: appointment.client.phone,
        message: `⚠️ Seu agendamento foi reagendado!\n\nNova data: ${data.startTime.toLocaleDateString('pt-BR')}\nNovo horário: ${data.startTime.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`,
        appointmentId: appointment.id
      });
    }

    return appointment;
  }

  /**
   * EXEMPLO 5: Cancelar appointment com notificação
   */
  async cancel(id: string, cancelledBy: string, reason?: string) {
    const appointment = await this.findById(id);

    if (appointment.status === 'CANCELLED') {
      throw new AppError('Appointment is already cancelled', 400);
    }

    const cancelled = await prisma.appointment.update({
      where: { id },
      data: {
        status: 'CANCELLED',
        notes: reason ? `${appointment.notes || ''}\nMotivo cancelamento: ${reason}` : appointment.notes,
        updatedBy: cancelledBy,
      },
      include: {
        client: true,
        staff: {
          include: {
            user: {
              select: { name: true, phone: true },
            },
          },
        },
      },
    });

    // ✅ NOVO: Invalidar caches
    await Promise.all([
      cacheService.del(`appointment:${id}`),
      cacheService.invalidateEntity('appointments', appointment.clientId),
      cacheService.invalidateEntity('appointments', appointment.staffId),
    ]);

    // ✅ NOVO: Notificar cancelamento
    await addNotificationJob({
      type: 'whatsapp',
      recipient: cancelled.client.phone,
      message: `❌ Agendamento cancelado\n\nData: ${appointment.startTime.toLocaleDateString('pt-BR')}\nHorário: ${appointment.startTime.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}\n${reason ? `\nMotivo: ${reason}` : ''}`,
      appointmentId: cancelled.id
    });

    return cancelled;
  }

  /**
   * EXEMPLO 6: Confirmar appointment (check-in)
   */
  async confirm(id: string, confirmedBy: string) {
    const appointment = await this.findById(id);

    if (appointment.status === 'COMPLETED') {
      throw new AppError('Appointment is already completed', 400);
    }

    const confirmed = await prisma.appointment.update({
      where: { id },
      data: {
        status: 'CONFIRMED',
        updatedBy: confirmedBy,
      },
      include: {
        client: true,
      },
    });

    // ✅ NOVO: Invalidar cache
    await cacheService.del(`appointment:${id}`);

    return confirmed;
  }

  /**
   * EXEMPLO 7: Completar appointment
   */
  async complete(id: string, completedBy: string) {
    const appointment = await this.findById(id);

    if (appointment.status === 'COMPLETED') {
      throw new AppError('Appointment is already completed', 400);
    }

    const completed = await prisma.appointment.update({
      where: { id },
      data: {
        status: 'COMPLETED',
        updatedBy: completedBy,
      },
      include: {
        client: true,
        payments: true,
      },
    });

    // ✅ NOVO: Invalidar cache
    await cacheService.del(`appointment:${id}`);

    // ✅ NOVO: Enviar solicitação de avaliação (após 1 hora)
    await addNotificationJob(
      {
        type: 'whatsapp',
        recipient: completed.client.phone,
        message: `Obrigado por escolher nosso salão! 💇\n\nQue tal avaliar nosso atendimento? Sua opinião é muito importante!`,
        appointmentId: completed.id
      },
      3600000 // delay de 1 hora em ms
    );

    return completed;
  }

  /**
   * EXEMPLO 8: Obter estatísticas com cache
   */
  async getStats(staffId?: string, startDate?: Date, endDate?: Date) {
    const cacheKey = `stats:appointments:${staffId || 'all'}:${startDate?.toISOString() || 'all'}:${endDate?.toISOString() || 'all'}`;

    return await cacheService.getOrSet(
      cacheKey,
      async () => {
        const where: any = {};
        
        if (staffId) where.staffId = staffId;
        if (startDate || endDate) {
          where.startTime = {};
          if (startDate) where.startTime.gte = startDate;
          if (endDate) where.startTime.lte = endDate;
        }

        const [total, completed, cancelled, pending, revenue] = await Promise.all([
          prisma.appointment.count({ where }),
          prisma.appointment.count({ where: { ...where, status: 'COMPLETED' } }),
          prisma.appointment.count({ where: { ...where, status: 'CANCELLED' } }),
          prisma.appointment.count({ where: { ...where, status: 'PENDING' } }),
          prisma.appointment.aggregate({
            where: { ...where, status: 'COMPLETED' },
            _sum: { totalAmount: true }
          })
        ]);

        return {
          total,
          completed,
          cancelled,
          pending,
          revenue: revenue._sum.totalAmount || 0,
          completionRate: total > 0 ? ((completed / total) * 100).toFixed(2) : 0,
          cancellationRate: total > 0 ? ((cancelled / total) * 100).toFixed(2) : 0,
        };
      },
      600 // cache por 10 minutos
    );
  }
}

// Tipos de exemplo
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
}
