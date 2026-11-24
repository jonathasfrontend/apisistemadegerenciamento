import { Router } from 'express';
import { authenticate, checkPermission } from '../../../../middlewares/auth.jwt';
import { validateZod } from '../../../../middlewares/validate';
import * as controller from './other-incomes.controller';
import {
  createOtherIncomeSchema,
  listOtherIncomesSchema,
  otherIncomeIdSchema,
  updateOtherIncomeSchema,
} from './other-incomes.schemas';

const router = Router();
router.use(authenticate);

// spec:1753 — leitura com finance.receivables.list; escrita com finance.catalog.manage.
router.get('/', checkPermission('finance.receivables.list'), validateZod(listOtherIncomesSchema), controller.list);
router.get('/:id', checkPermission('finance.receivables.list'), validateZod(otherIncomeIdSchema), controller.getById);
router.post('/', checkPermission('finance.catalog.manage'), validateZod(createOtherIncomeSchema), controller.create);
router.put('/:id', checkPermission('finance.catalog.manage'), validateZod(updateOtherIncomeSchema), controller.update);
router.delete('/:id', checkPermission('finance.catalog.manage'), validateZod(otherIncomeIdSchema), controller.remove);

export default router;
