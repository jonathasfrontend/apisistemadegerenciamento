import { Router } from 'express';
import { authenticate, checkPermission } from '../../../../middlewares/auth.jwt';
import { validateZod } from '../../../../middlewares/validate';
import * as controller from './suppliers.controller';
import {
  createSupplierSchema,
  listSuppliersSchema,
  supplierIdSchema,
  updateSupplierSchema,
} from './suppliers.schemas';

const router = Router();
router.use(authenticate);
router.use(checkPermission('finance.catalog.manage'));

router.get('/', validateZod(listSuppliersSchema), controller.list);
router.get('/:id', validateZod(supplierIdSchema), controller.getById);
router.post('/', validateZod(createSupplierSchema), controller.create);
router.put('/:id', validateZod(updateSupplierSchema), controller.update);
router.delete('/:id', validateZod(supplierIdSchema), controller.remove);

export default router;
