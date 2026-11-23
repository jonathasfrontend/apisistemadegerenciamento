import { Router } from 'express';
import { authenticate, checkPermission } from '../../../../middlewares/auth.jwt';
import { validateZod } from '../../../../middlewares/validate';
import * as controller from './categories.controller';
import {
  categoryIdSchema,
  createCategorySchema,
  listCategoriesSchema,
  updateCategorySchema,
} from './categories.schemas';

const router = Router();
router.use(authenticate);

router.get(
  '/',
  checkPermission('finance.dashboard'),
  validateZod(listCategoriesSchema),
  controller.list
);
router.get(
  '/:id',
  checkPermission('finance.dashboard'),
  validateZod(categoryIdSchema),
  controller.getById
);
router.post(
  '/',
  checkPermission('finance.catalog.manage'),
  validateZod(createCategorySchema),
  controller.create
);
router.put(
  '/:id',
  checkPermission('finance.catalog.manage'),
  validateZod(updateCategorySchema),
  controller.update
);
router.delete(
  '/:id',
  checkPermission('finance.catalog.manage'),
  validateZod(categoryIdSchema),
  controller.remove
);

export default router;
