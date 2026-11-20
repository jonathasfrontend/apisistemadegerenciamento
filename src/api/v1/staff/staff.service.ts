import { CommissionType, NotificationType, Staff } from '@prisma/client';
import { createPrismaClient } from '../../../config/db';
import { notifyResource } from '../notifications/notifications.service';
import { AppError } from '../../../middlewares/error.handler';
import { assertStaffProfileEligibility } from './staff-eligibility';

const prisma = createPrismaClient();

interface CreateStaffDTO {
  userId: string;
  specialties: string[];
  commissionType?: CommissionType;
  commissionValue?: number;
  workSchedule?: any;
  blockedDates?: any;
  isAvailable?: boolean;
}

interface UpdateStaffDTO {
  specialties?: string[];
  commissionType?: CommissionType;
  commissionValue?: number;
  workSchedule?: any;
  blockedDates?: any;
  isAvailable?: boolean;
}

interface StaffFilters {
  isAvailable?: boolean;
  specialty?: string;
  search?: string;
}

/**
 * Item da listagem unificada: usuário com cargo (qualquer) e com ou sem perfil de staff.
 * Regra de `id`: perfilado = staff.id; pendente = userId.
 * Consumidor deve checar `hasProfile` antes de usar `id` como staff.id.
 */
export interface StaffListItem {
  id: string;
  userId: string;
  hasProfile: boolean;
  role: { id: string; name: string } | null;
  user: {
    id: string;
    name: string;
    email: string;
    phone: string | null;
    avatar: string | null;
    isActive: boolean;
  };
  // Campos de perfil — presentes somente quando hasProfile === true
  specialties?: string[];
  commissionType?: CommissionType;
  commissionValue?: number;
  workSchedule?: any;
  blockedDates?: any;
  isAvailable?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
  _count?: { appointments: number; commissions: number };
}

export class StaffService {
  /**
   * Criar um novo profissional
   */
  async create(data: CreateStaffDTO): Promise<Staff> {
    // Elegibilidade: usuário existe, está ativo e tem cargo (qualquer).
    // (frontend só filtra client-side — a decisão final é do backend)
    const user = await prisma.user.findUnique({
      where: { id: data.userId },
      include: { role: { select: { name: true } } },
    });

    assertStaffProfileEligibility(user);

    // Verifica se o usuário já tem perfil de staff
    const existingStaff = await prisma.staff.findUnique({
      where: { userId: data.userId },
    });

    if (existingStaff) {
      throw new Error('User already has a staff profile');
    }

    const staff = await prisma.staff.create({
      data: {
        userId: data.userId,
        specialties: data.specialties,
        commissionType: data.commissionType || CommissionType.PERCENT,
        commissionValue: data.commissionValue || 0,
        workSchedule: data.workSchedule || {},
        blockedDates: data.blockedDates || [],
        // Disponibilidade informada na criação é respeitada (default do banco: true).
        isAvailable: data.isAvailable ?? true,
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            avatar: true,
          },
        },
      },
    });

    // Avisar os Admins (best-effort: nunca derruba a criação do profissional)
    await notifyResource(
      {
        type: NotificationType.NEW_STAFF,
        message: `Novo profissional cadastrado: ${staff.user.name}`,
        link: `/staff/${staff.id}`,
        dedupeKey: `NEW_STAFF:${staff.id}`,
      },
      { roleNames: ['Admin'] }
    );

    return staff;
  }

  /**
   * Listar profissionais com filtros — união users × staff.
   * Lista usuários ativos com cargo; quem não tem perfil de staff vem com
   * hasProfile=false e sem campos de perfil.
   */
  async list(filters: StaffFilters = {}): Promise<StaffListItem[]> {
    const where: any = {
      isActive: true,
      roleId: { not: null },
    };

    if (filters.isAvailable !== undefined) {
      // Join filtra itens sem perfil naturalmente (não têm isAvailable)
      where.staff = { ...(where.staff || {}), isAvailable: filters.isAvailable };
    }

    if (filters.specialty) {
      where.staff = { ...(where.staff || {}), specialties: { has: filters.specialty } };
    }

    if (filters.search) {
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { email: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const users = await prisma.user.findMany({
      where,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        avatar: true,
        isActive: true,
        role: { select: { id: true, name: true } },
        staff: {
          include: {
            _count: {
              select: {
                appointments: true,
                commissions: true,
              },
            },
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    return users.map((u) => {
      const { staff, ...user } = u;
      if (staff) {
        return {
          ...staff,
          hasProfile: true,
          role: user.role,
          user,
        };
      }
      // Pendente: sem perfil de staff — id = userId (consumidor checa hasProfile)
      return {
        id: u.id,
        userId: u.id,
        hasProfile: false,
        role: user.role,
        user,
      };
    });
  }

  /**
   * Buscar profissional por ID
   */
  async getById(id: string): Promise<Staff | null> {
    return await prisma.staff.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            avatar: true,
            isActive: true,
          },
        },
        _count: {
          select: {
            appointments: true,
            commissions: true,
          },
        },
      },
    });
  }

  /**
   * Atualizar profissional
   */
  async update(id: string, data: UpdateStaffDTO): Promise<Staff> {
    return await prisma.staff.update({
      where: { id },
      data,
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            avatar: true,
          },
        },
      },
    });
  }

  /**
   * Deletar profissional
   */
  async delete(id: string): Promise<Staff> {
    return await prisma.staff.update({
      where: { id },
      data: { isAvailable: false },
      include: {
        user: true,
      },
    });
  }

  /**
   * Verificar disponibilidade do profissional em uma data
   */
  async checkAvailability(staffId: string, date: Date) {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    // Buscar agendamentos do dia
    const appointments = await prisma.appointment.findMany({
      where: {
        staffId,
        startTime: {
          gte: startOfDay,
          lte: endOfDay,
        },
        status: {
          notIn: ['CANCELLED', 'NO_SHOW'],
        },
      },
      orderBy: {
        startTime: 'asc',
      },
      select: {
        startTime: true,
        endTime: true,
        status: true,
      },
    });

    // Buscar horário de trabalho do profissional
    const staff = await prisma.staff.findUnique({
      where: { id: staffId },
      select: {
        workSchedule: true,
        blockedDates: true,
      },
    });

    return {
      date: date.toISOString().split('T')[0],
      appointments,
      workSchedule: staff?.workSchedule,
      blockedDates: staff?.blockedDates,
    };
  }

  /**
   * Obter horário de trabalho do profissional
   */
  async getSchedule(staffId: string) {
    const staff = await prisma.staff.findUnique({
      where: { id: staffId },
      select: {
        workSchedule: true,
        blockedDates: true,
      },
    });

    return staff;
  }

  /**
   * Atribuir role a um usuário staff
   * Paridade de contrato com POST /roles/:roleId/assign/:userId:
   * staff/cargo inexistente → 404; cargo inativo → 400.
   */
  async assignRole(staffId: string, roleId: string) {
    // Verificar se o staff existe
    const staff = await prisma.staff.findUnique({
      where: { id: staffId },
      include: { user: true },
    });

    if (!staff) {
      throw new AppError('Staff not found', 404);
    }

    // Verificar se a role existe
    const role: any = await (prisma as any).role.findUnique({
      where: { id: roleId },
    });

    if (!role) {
      throw new AppError('Role not found', 404);
    }

    // Paridade com POST /roles/:roleId/assign/:userId — cargo inativo não é atribuível
    if (!role.isActive) {
      throw new AppError('Role is inactive', 400);
    }

    // Atualizar a role do usuário
    await prisma.user.update({
      where: { id: staff.userId },
      data: { roleId } as any,
    });

    return {
      message: 'Role assigned successfully',
      staff: {
        id: staff.id,
        userId: staff.userId,
        userName: staff.user.name,
        roleName: role.name,
      },
    };
  }
}
