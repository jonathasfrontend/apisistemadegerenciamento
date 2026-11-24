/** [F1.4] Rotas A pagar — RBAC por operação, companyId sempre de req.user. */
import { Router } from 'express';
import { authenticate, checkPermission } from '../../../../middlewares/auth.jwt';
import { validateZod } from '../../../../middlewares/validate';
import * as controller from './payables.controller';
import {
  createPayableSchema,
  listPayablesSchema,
  payableIdSchema,
  payPayableSchema,
  updatePayableSchema,
} from './payables.schemas';

const router = Router();
router.use(authenticate);

router.get('/', checkPermission('finance.payables.list'), validateZod(listPayablesSchema), controller.list);
router.get('/:id', checkPermission('finance.payables.list'), validateZod(payableIdSchema), controller.getById);
router.post('/', checkPermission('finance.payables.create'), validateZod(createPayableSchema), controller.create);
router.put('/:id', checkPermission('finance.payables.update'), validateZod(updatePayableSchema), controller.update);
router.post('/:id/pay', checkPermission('finance.payables.pay'), validateZod(payPayableSchema), controller.pay);
router.post('/:id/cancel', checkPermission('finance.payables.update'), validateZod(payableIdSchema), controller.cancel);
router.delete('/:id', checkPermission('finance.payables.delete'), validateZod(payableIdSchema), controller.remove);

export default router;
