import { Notification, NotificationChannel, NotificationStatus, NotificationType } from '@prisma/client';
import { createPrismaClient } from '../../../config/db';

const prisma = createPrismaClient();

export interface NotifyPayload {
  type: NotificationType;
  message: string;
  appointmentId?: string;
  /** Rota interna para onde o clique leva (ex.: `/appointments/{id}`). */
  link?: string;
  /**
   * Chave do evento — 1 registro por usuário por chave (índice único
   * `[userId, dedupeKey]`). Evita duplicata em retry, corrida entre
   * worker e reconciliador, ou re-notificação do mesmo evento.
   */
  dedupeKey?: string;
}

interface NotifyTarget {
  userIds?: string[];
  roleNames?: string[];
}

/**
 * Cria a notificação in-app para cada usuário alvo.
 * Best-effort: falha nunca propaga para quem chamou.
 * 0B.1: companyId é obrigatório — notificação nunca cruza a fronteira do tenant.
 */
async function createNotifications(
  users: { id: string; email: string }[],
  payload: NotifyPayload,
  companyId: string
): Promise<void> {
  if (users.length === 0) return;

  await prisma.notification.createMany({
    data: users.map((u) => ({
      userId: u.id,
      companyId,
      appointmentId: payload.appointmentId,
      link: payload.link,
      dedupeKey: payload.dedupeKey,
      type: payload.type,
      channel: NotificationChannel.IN_APP,
      recipient: u.email,
      message: payload.message,
      status: NotificationStatus.DELIVERED,
    })),
    // Chave duplicada (mesmo usuário + mesmo evento) é ignorada, não dá erro.
    skipDuplicates: true,
  });
}

/** Notifica usuários específicos. Usuários inativos não recebem. */
export async function notifyUsers(
  userIds: string[],
  payload: NotifyPayload,
  companyId: string
): Promise<void> {
  try {
    const ids = [...new Set(userIds.filter(Boolean))];
    if (ids.length === 0) return;

    const users = await prisma.user.findMany({
      where: { id: { in: ids }, isActive: true, companyId },
      select: { id: true, email: true },
    });

    await createNotifications(users, payload, companyId);
  } catch (error) {
    console.error('[notifications] Falha ao criar notificações:', error);
  }
}

/** Notifica todos os usuários ativos cujo role esteja na lista informada. */
export async function notifyRoles(
  roleNames: string[],
  payload: NotifyPayload,
  companyId: string
): Promise<void> {
  try {
    const users = await prisma.user.findMany({
      where: {
        isActive: true,
        companyId,
        role: { name: { in: roleNames } },
      },
      select: { id: true, email: true },
    });

    await createNotifications(users, payload, companyId);
  } catch (error) {
    console.error('[notifications] Falha ao criar notificações:', error);
  }
}

/** Notifica a união de destinatários explícitos e por role. */
export async function notifyResource(
  payload: NotifyPayload,
  targets: NotifyTarget,
  companyId: string
): Promise<void> {
  try {
    const ids = new Set((targets.userIds ?? []).filter(Boolean));

    if (targets.roleNames?.length) {
      const roleUsers = await prisma.user.findMany({
        where: {
          isActive: true,
          companyId,
          role: { name: { in: targets.roleNames } },
        },
        select: { id: true },
      });
      roleUsers.forEach((u) => ids.add(u.id));
    }

    await notifyUsers([...ids], payload, companyId);
  } catch (error) {
    console.error('[notifications] Falha ao notificar recurso:', error);
  }
}

export class NotificationsService {
  async list(userId: string, companyId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const where = { userId, companyId };

    const [notifications, total] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          type: true,
          channel: true,
          message: true,
          status: true,
          readAt: true,
          appointmentId: true,
          link: true,
          createdAt: true,
        },
      }),
      prisma.notification.count({ where }),
    ]);

    return { notifications, total, page, limit };
  }

  async unreadCount(userId: string, companyId: string): Promise<number> {
    return prisma.notification.count({
      where: { userId, companyId, readAt: null },
    });
  }

  async markRead(userId: string, id: string, companyId: string): Promise<Notification> {
    const notification = await prisma.notification.findFirst({
      where: { id, companyId },
    });

    // 404 se não existir OU não pertencer ao usuário (não vazar existência)
    if (!notification || notification.userId !== userId) {
      throw Object.assign(new Error('Notification not found'), { statusCode: 404 });
    }

    return prisma.notification.update({
      where: { id },
      data: { readAt: new Date() },
    });
  }

  async markAllRead(userId: string, companyId: string): Promise<{ count: number }> {
    const result = await prisma.notification.updateMany({
      where: { userId, companyId, readAt: null },
      data: { readAt: new Date() },
    });

    return { count: result.count };
  }
}
