import { Router } from 'express';
import { authenticate, checkPermission } from '../../../../middlewares/auth.jwt';
import { validateZod } from '../../../../middlewares/validate';
import * as controller from './bank-accounts.controller';
import {
  balanceSchema,
  bankAccountIdSchema,
  createBankAccountSchema,
  listBankAccountsSchema,
  updateBankAccountSchema,
} from './bank-accounts.schemas';

const router = Router();
router.use(authenticate);

router.get(
  '/',
  checkPermission('finance.catalog.manage'),
  validateZod(listBankAccountsSchema),
  controller.list
);
router.get(
  '/:id/balance',
  checkPermission('finance.bank.view'),
  validateZod(balanceSchema),
  controller.balance
);
router.get(
  '/:id',
  checkPermission('finance.catalog.manage'),
  validateZod(bankAccountIdSchema),
  controller.getById
);
router.post(
  '/',
  checkPermission('finance.catalog.manage'),
  validateZod(createBankAccountSchema),
  controller.create
);
router.put(
  '/:id',
  checkPermission('finance.catalog.manage'),
  validateZod(updateBankAccountSchema),
  controller.update
);
router.delete(
  '/:id',
  checkPermission('finance.catalog.manage'),
  validateZod(bankAccountIdSchema),
  controller.remove
);

export default router;
