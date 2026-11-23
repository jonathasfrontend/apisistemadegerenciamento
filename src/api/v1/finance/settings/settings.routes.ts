import { Router } from 'express';
import { authenticate, checkPermission } from '../../../../middlewares/auth.jwt';
import { validateZod } from '../../../../middlewares/validate';
import * as controller from './settings.controller';
import { updateSettingsSchema } from './settings.schemas';

const router = Router();
router.use(authenticate);

router.get('/', checkPermission('finance.settings'), controller.get);
router.put(
  '/',
  checkPermission('finance.settings'),
  validateZod(updateSettingsSchema),
  controller.update
);

export default router;
