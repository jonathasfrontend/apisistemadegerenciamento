import { NotificationType, User } from '@prisma/client';
import bcrypt from 'bcrypt';
import { AppError } from '../../../middlewares/error.handler';

import { createPrismaClient } from '../../../config/db';
import { notifyResource } from '../notifications/notifications.service';

const prisma = createPrismaClient();

interface CreateUserDTO {
  email: string;
  password: string;
  name: string;
  phone?: string;
  avatar?: string;
  roleId?: string;
}

interface UpdateUserDTO {
  name?: string;
  phone?: string;
  avatar?: string;
  roleId?: string;
  isActive?: boolean;
}

interface UserFilters {
  isActive?: boolean;
  roleId?: string;
  search?: string;
}

export class UsersService {
  /**
   * Criar um novo usuário
   */
  async create(data: CreateUserDTO, companyId: string): Promise<Omit<User, 'passwordHash'>> {
    // Verificar se o email já existe
    const existingUser = await prisma.user.findFirst({
      where: { email: data.email.toLowerCase(), companyId },
    });

    if (existingUser) { // Email já registrado
      throw new AppError('Email already registered', 400);
    }

    // Hash da senha
    const passwordHash = await bcrypt.hash(data.password, 10);

    // Criar usuário
    const user = await prisma.user.create({
      data: {
        email: data.email.toLowerCase(),
        passwordHash,
        name: data.name,
        phone: data.phone,
        avatar: data.avatar,
        roleId: data.roleId,
        companyId,
      },
      include: {
        role: {
          include: {
            rolePermissions: {
              include: {
                permission: true,
              },
            },
          },
        },
      },
    });

    // Avisar os Admins (best-effort: nunca derruba a criação do usuário)
    await notifyResource(
      {
        type: NotificationType.NEW_USER,
        message: `Novo usuário cadastrado: ${user.name} (${user.email})`,
        link: '/staff',
        dedupeKey: `NEW_USER:${user.id}`,
      },
      { roleNames: ['Admin'] },
      companyId
    );

    // Remover passwordHash do retorno
    const { passwordHash: _, ...userWithoutPassword } = user;
    return userWithoutPassword as any;
  }

  /**
   * Listar usuários com filtros
   */
  async list(filters: UserFilters = {}, companyId: string): Promise<Omit<User, 'passwordHash'>[]> {
    const where: any = { companyId };

    if (filters.isActive !== undefined) {
      where.isActive = filters.isActive;
    }

    if (filters.roleId) {
      where.roleId = filters.roleId;
    }

    if (filters.search) {
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { email: { contains: filters.search, mode: 'insensitive' } },
        { phone: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const users = await prisma.user.findMany({
      where,
      include: {
        role: {
          select: {
            id: true,
            name: true,
            description: true,
          },
        },
        staff: {
          select: {
            id: true,
            specialties: true,
            isAvailable: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    // Remover passwordHash de todos os usuários
    return users.map(({ passwordHash, ...user }) => user) as any;
  }

  /**
   * Buscar usuário por ID
   */
  async getById(id: string, companyId: string): Promise<Omit<User, 'passwordHash'> | null> {
    const user = await prisma.user.findFirst({
      where: { id, companyId },
      include: {
        role: {
          include: {
            rolePermissions: {
              include: {
                permission: true,
              },
            },
          },
        },
        staff: {
          select: {
            id: true,
            specialties: true,
            commissionType: true,
            commissionValue: true,
            workSchedule: true,
            isAvailable: true,
          },
        },
      },
    });

    if (!user) {
      return null;
    }

    // Remover passwordHash
    const { passwordHash, ...userWithoutPassword } = user;
    return userWithoutPassword as any;
  }

  /**
   * Atualizar usuário
   */
  async update(id: string, data: UpdateUserDTO, companyId: string): Promise<Omit<User, 'passwordHash'>> {
    // Verificar se o usuário existe
    const existingUser = await prisma.user.findFirst({
      where: { id, companyId },
    });

    if (!existingUser) {
      throw new AppError('User not found', 404);
    }

    // Atualizar usuário
    const user = await prisma.user.update({
      where: { id },
      data: {
        name: data.name,
        phone: data.phone,
        avatar: data.avatar,
        roleId: data.roleId,
        isActive: data.isActive,
      },
      include: {
        role: {
          select: {
            id: true,
            name: true,
            description: true,
          },
        },
        staff: {
          select: {
            id: true,
            specialties: true,
            isAvailable: true,
          },
        },
      },
    });

    // Remover passwordHash
    const { passwordHash, ...userWithoutPassword } = user;
    return userWithoutPassword as any;
  }

  /**
   * Alterar senha do usuário
   */
  async changePassword(id: string, currentPassword: string, newPassword: string, companyId: string): Promise<void> {
    const user = await prisma.user.findFirst({
      where: { id, companyId },
    });

    if (!user) {
      throw new AppError('User not found', 404);
    }

    // Verificar senha atual
    const isValidPassword = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!isValidPassword) {
      throw new AppError('Current password is incorrect', 400);
    }

    // Hash da nova senha
    const newPasswordHash = await bcrypt.hash(newPassword, 10);

    // Atualizar senha
    await prisma.user.update({
      where: { id },
      data: {
        passwordHash: newPasswordHash,
      },
    });
  }

  /**
   * Desativar usuário (soft delete)
   */
  async deactivate(id: string, companyId: string): Promise<void> {
    const user = await prisma.user.findFirst({
      where: { id, companyId },
    });

    if (!user) {
      throw new AppError('User not found', 404);
    }

    await prisma.user.update({
      where: { id },
      data: {
        isActive: false,
      },
    });
  }

  /**
   * Ativar usuário
   */
  async activate(id: string, companyId: string): Promise<void> {
    const user = await prisma.user.findFirst({
      where: { id, companyId },
    });

    if (!user) {
      throw new AppError('User not found', 404);
    }

    await prisma.user.update({
      where: { id },
      data: {
        isActive: true,
      },
    });
  }

  /**
   * Deletar usuário permanentemente
   */
  async delete(id: string, companyId: string): Promise<void> {
    const user = await prisma.user.findFirst({
      where: { id, companyId },
    });

    if (!user) {
      throw new AppError('User not found', 404);
    }

    await prisma.user.delete({
      where: { id },
    });
  }
}
