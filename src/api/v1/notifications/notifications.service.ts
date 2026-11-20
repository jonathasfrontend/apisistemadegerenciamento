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
 */
async function createNotifications(
  users: { id: string; email: string }[],
  payload: NotifyPayload
): Promise<void> {
  if (users.length === 0) return;

  await prisma.notification.createMany({
    data: users.map((u) => ({
      userId: u.id,
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

/**
 * Notifica usuários específicos (ex.: o profissional do agendamento).
 * Usuários inativos não recebem.
 */
export async function notifyUsers(
  userIds: string[],
  payload: NotifyPayload
): Promise<void> {
  try {
    const ids = [...new Set(userIds.filter(Boolean))];
    if (ids.length === 0) return;

    const users = await prisma.user.findMany({
      where: { id: { in: ids }, isActive: true },
      select: { id: true, email: true },
    });

    await createNotifications(users, payload);
  } catch (error) {
    // Notificação é best-effort: logar e seguir
    console.error('[notifications] Falha ao criar notificações:', error);
  }
}

/**
 * Cria uma notificação in-app para todos os usuários ativos cujo role
 * esteja na lista informada. Falha nunca deve quebrar o fluxo principal.
 */
export async function notifyRoles(
  roleNames: string[],
  payload: NotifyPayload
): Promise<void> {
  try {
    const users = await prisma.user.findMany({
      where: {
        isActive: true,
        role: { name: { in: roleNames } },
      },
      select: { id: true, email: true },
    });

    await createNotifications(users, payload);
  } catch (error) {
    // Notificação é best-effort: logar e seguir
    // (logger importado dinamicamente evita ciclo de import)
    console.error('[notifications] Falha ao criar notificações:', error);
  }
}

/**
 * Notifica a união de destinatários explícitos (`userIds`) e por role
 * (`roleNames`). Sem nenhum dos dois, não faz nada.
 */
export async function notifyResource(
  payload: NotifyPayload,
  targets: NotifyTarget
): Promise<void> {
  try {
    const ids = new Set((targets.userIds ?? []).filter(Boolean));

    if (targets.roleNames?.length) {
      const roleUsers = await prisma.user.findMany({
        where: {
          isActive: true,
          role: { name: { in: targets.roleNames } },
        },
        select: { id: true },
      });
      roleUsers.forEach((u) => ids.add(u.id));
    }

    await notifyUsers([...ids], payload);
  } catch (error) {
    console.error('[notifications] Falha ao notificar recurso:', error);
  }
}

export class NotificationsService {
  async list(userId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;

    const [notifications, total] = await Promise.all([
      prisma.notification.findMany({
        where: { userId },
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
      prisma.notification.count({ where: { userId } }),
    ]);

    return { notifications, total, page, limit };
  }

  async unreadCount(userId: string): Promise<number> {
    return prisma.notification.count({
      where: { userId, readAt: null },
    });
  }

  async markRead(userId: string, id: string): Promise<Notification> {
    const notification = await prisma.notification.findUnique({
      where: { id },
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

  async markAllRead(userId: string): Promise<{ count: number }> {
    const result = await prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });

    return { count: result.count };
  }
}
