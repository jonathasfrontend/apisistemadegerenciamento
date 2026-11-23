import { Router } from 'express';
import { authenticate, checkPermission } from '../../../../middlewares/auth.jwt';
import { validateZod } from '../../../../middlewares/validate';
import * as controller from './cash.controller';
import {
  createRegisterSchema,
  listRegistersSchema,
  registerIdSchema,
  updateRegisterSchema,
} from './cash.schemas';

const router = Router();
router.use(authenticate);

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

export default router;
