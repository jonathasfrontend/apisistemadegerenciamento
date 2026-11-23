import { Router } from 'express';
import { authenticate, checkPermission } from '../../../../middlewares/auth.jwt';
import { validateZod } from '../../../../middlewares/validate';
import * as controller from './acquirers.controller';
import {
  acquirerIdSchema,
  createAcquirerSchema,
  listAcquirersSchema,
  updateAcquirerSchema,
} from './acquirers.schemas';

const router = Router();
router.use(authenticate);
router.use(checkPermission('finance.catalog.manage'));

router.get('/', validateZod(listAcquirersSchema), controller.list);
router.get('/:id', validateZod(acquirerIdSchema), controller.getById);
router.post('/', validateZod(createAcquirerSchema), controller.create);
router.put('/:id', validateZod(updateAcquirerSchema), controller.update);
router.delete('/:id', validateZod(acquirerIdSchema), controller.remove);

export default router;
