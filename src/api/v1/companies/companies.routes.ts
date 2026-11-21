import { Router } from 'express';
import * as companiesController from './companies.controller';
import { authenticate, checkPermission } from '../../../middlewares/auth.jwt';
import { validateZod } from '../../../middlewares/validate';
import { z } from 'zod';

const router = Router();

const createCompanySchema = z.object({
  body: z.object({
    name: z.string().trim().min(2, 'Nome deve ter ao menos 2 caracteres'),
    document: z.string().trim().max(20).optional(),
    timezone: z.string().trim().min(1).optional(),
    isActive: z.boolean().optional(),
  }),
});

const updateCompanySchema = z.object({
  body: z.object({
    name: z.string().trim().min(2).optional(),
    document: z.string().trim().max(20).nullable().optional(),
    timezone: z.string().trim().min(1).optional(),
    isActive: z.boolean().optional(),
  }),
});

// Nenhuma rota pública:RBAC global, companyId do req.user não participa aqui.
router.use(authenticate);

router.get('/', checkPermission('companies.read'), companiesController.list);
router.get('/:id', checkPermission('companies.read'), companiesController.getById);
router.post(
  '/',
  checkPermission('companies.create'),
  validateZod(createCompanySchema),
  companiesController.create
);
router.put(
  '/:id',
  checkPermission('companies.update'),
  validateZod(updateCompanySchema),
  companiesController.update
);

export default router;
