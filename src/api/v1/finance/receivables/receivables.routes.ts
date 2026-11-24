import { Router } from 'express';
import { authenticate, checkPermission } from '../../../../middlewares/auth.jwt';
import { validateZod } from '../../../../middlewares/validate';
import * as controller from './receivables.controller';
import { listReceivablesSchema } from './receivables.schemas';

const router = Router();
router.use(authenticate);
router.use(checkPermission('finance.receivables.list'));

router.get('/', validateZod(listReceivablesSchema), controller.list);

export default router;
