import { Router } from 'express';
import { authenticate, checkPermission } from '../../../../middlewares/auth.jwt';
import { validateZod } from '../../../../middlewares/validate';
import * as controller from './bank-transactions.controller';
import {
  createBankTransactionSchema,
  getBankTransactionSchema,
  listBankTransactionsSchema,
  patchBankTransactionSchema,
} from './bank-transactions.schemas';

const router = Router();
router.use(authenticate);

router.get(
  '/',
  checkPermission('finance.bank.view'),
  validateZod(listBankTransactionsSchema),
  controller.list
);
router.post(
  '/',
  checkPermission('finance.bank.import'),
  validateZod(createBankTransactionSchema),
  controller.create
);
router.get(
  '/:id',
  checkPermission('finance.bank.view'),
  validateZod(getBankTransactionSchema),
  controller.getById
);
router.patch(
  '/:id',
  checkPermission('finance.reconcile'),
  validateZod(patchBankTransactionSchema),
  controller.patch
);

export default router;
