import { Router } from 'express';
import { authenticate, checkPermission } from '../../../../middlewares/auth.jwt';
import { validateZod } from '../../../../middlewares/validate';
import * as controller from './bank-transactions.controller';
import {
  bulkConfirmSchema,
  createBankTransactionSchema,
  createEntrySchema,
  getBankTransactionSchema,
  listBankTransactionsSchema,
  patchBankTransactionSchema,
  reconcileBankTransactionSchema,
  suggestionsSchema,
  undoReconciliationSchema,
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

// [F2.5] Rotas específicas ANTES de /:id para não serem capturadas por getById.
router.post(
  '/bulk-confirm',
  checkPermission('finance.reconcile'),
  validateZod(bulkConfirmSchema),
  controller.bulkConfirmSuggestions
);
router.get(
  '/:id/suggestions',
  checkPermission('finance.bank.view'),
  validateZod(suggestionsSchema),
  controller.getSuggestions
);
router.post(
  '/:id/suggestions',
  checkPermission('finance.reconcile'),
  validateZod(suggestionsSchema),
  controller.persistSuggestions
);
router.post(
  '/:id/reconcile',
  checkPermission('finance.reconcile'),
  validateZod(reconcileBankTransactionSchema),
  controller.reconcileTx
);
router.delete(
  '/:id/reconcile',
  checkPermission('finance.reconcile'),
  validateZod(undoReconciliationSchema),
  controller.undoReconcile
);
router.post(
  '/:id/create-entry',
  checkPermission('finance.reconcile'),
  validateZod(createEntrySchema),
  controller.createEntryFromTx
);

export default router;
