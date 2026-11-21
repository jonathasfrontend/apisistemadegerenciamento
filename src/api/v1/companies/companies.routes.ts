import { Router } from 'express';
import * as companiesController from './companies.controller';
import { authenticate, checkPermission } from '../../../middlewares/auth.jwt';
import { validateZod } from '../../../middlewares/validate';
import { z } from 'zod';

const router = Router();

// Valida aliases IANA válidos (UTC, GMT, Etc/UTC) que a lista canônica da ICU
// não inclui. Intl.DateTimeFormat lança RangeError para zonas inexistentes.
const timezoneSchema = z
  .string()
  .trim()
  .min(1, 'Fuso horário é obrigatório')
  .refine((value) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, { message: 'Fuso horário inválido' });

const createCompanySchema = z.object({
  body: z.object({
    name: z
      .string()
      .trim()
      .min(2, 'Nome deve ter ao menos 2 caracteres')
      .max(100, 'Nome deve ter no máximo 100 caracteres'),
    document: z.string().trim().max(20).optional(),
    timezone: timezoneSchema.optional(),
    isActive: z.boolean().optional(),
  }),
});

const updateCompanySchema = z.object({
  body: z.object({
    name: z.string().trim().min(2).max(100).optional(),
    document: z.string().trim().max(20).nullable().optional(),
    timezone: timezoneSchema.optional(),
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
