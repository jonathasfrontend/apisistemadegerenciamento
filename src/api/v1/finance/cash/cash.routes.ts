import { Router } from 'express';
import { authenticate, checkPermission } from '../../../../middlewares/auth.jwt';
import { validateZod } from '../../../../middlewares/validate';
import * as controller from './cash.controller';
import {
  closeSessionSchema,
  createMovementSchema,
  createRegisterSchema,
  currentSessionSchema,
  listRegistersSchema,
  listSessionsSchema,
  openSessionSchema,
  registerIdSchema,
  reopenSessionSchema,
  sessionIdSchema,
  updateRegisterSchema,
  voidMovementSchema,
} from './cash.schemas';

const router = Router();
router.use(authenticate);

// ---------------------------------------------------------------------------
// F1.1c — caixas registrados
// ---------------------------------------------------------------------------

router.get(
  '/registers',
  checkPermission('finance.cash.operate'),
  validateZod(listRegistersSchema),
  controller.list
);
router.get(
  '/registers/:id',
  checkPermission('finance.cash.operate'),
  validateZod(registerIdSchema),
  controller.getById
);
router.post(
  '/registers',
  checkPermission('finance.catalog.manage'),
  validateZod(createRegisterSchema),
  controller.create
);
router.put(
  '/registers/:id',
  checkPermission('finance.catalog.manage'),
  validateZod(updateRegisterSchema),
  controller.update
);

// ---------------------------------------------------------------------------
// F1.2 — sessões de caixa (ordem: estáticas antes de /:id)
// ---------------------------------------------------------------------------

router.post(
  '/sessions/open',
  checkPermission('finance.cash.operate'),
  validateZod(openSessionSchema),
  controller.openSession
);
router.get(
  '/sessions/current',
  checkPermission('finance.cash.operate'),
  validateZod(currentSessionSchema),
  controller.currentSession
);
router.get(
  '/sessions',
  checkPermission('finance.cash.operate'),
  validateZod(listSessionsSchema),
  controller.listSessions
);
router.post(
  '/sessions/:id/movements',
  checkPermission('finance.cash.operate'),
  validateZod(createMovementSchema),
  controller.addMovement
);
router.post(
  '/sessions/:id/movements/:mid/void',
  checkPermission('finance.cash.operate'),
  validateZod(voidMovementSchema),
  controller.voidMovement
);
router.post(
  '/sessions/:id/close',
  checkPermission('finance.cash.operate'),
  validateZod(closeSessionSchema),
  controller.closeSession
);
router.post(
  '/sessions/:id/reopen',
  checkPermission('finance.cash.reopen'),
  validateZod(reopenSessionSchema),
  controller.reopenSession
);
router.get(
  '/sessions/:id',
  checkPermission('finance.cash.operate'),
  validateZod(sessionIdSchema),
  controller.getSessionById
);

export default router;
