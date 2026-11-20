import { Router } from 'express';
import * as notificationsController from './notifications.controller';
import { authenticate } from '../../../middlewares/auth.jwt';

const router = Router();

// Cada usuário lê apenas as próprias notificações — authenticate sem checkPermission
router.use(authenticate);

/**
 * @route   GET /api/v1/notifications
 * @desc    Listar notificações do usuário logado (paginado)
 * @access  Private
 */
router.get('/', notificationsController.getNotifications);

/**
 * @route   GET /api/v1/notifications/unread-count
 * @desc    Contagem de notificações não lidas do usuário logado
 * @access  Private
 */
router.get('/unread-count', notificationsController.getUnreadCount);

/**
 * @route   POST /api/v1/notifications/read-all
 * @desc    Marcar todas as notificações do usuário como lidas
 * @access  Private
 */
router.post('/read-all', notificationsController.markAllRead);

/**
 * @route   PATCH /api/v1/notifications/:id/read
 * @desc    Marcar uma notificação como lida
 * @access  Private (dono da notificação)
 */
router.patch('/:id/read', notificationsController.markRead);

export default router;
