import { Router } from 'express';
import { authenticate, checkPermission } from '../../../../middlewares/auth.jwt';
import { validateZod } from '../../../../middlewares/validate';
import * as controller from './overview.controller';
import { overviewSchema } from './overview.schemas';

const router = Router();
router.use(authenticate);
router.use(checkPermission('finance.reports'));

router.get('/', validateZod(overviewSchema), controller.get);

export default router;
