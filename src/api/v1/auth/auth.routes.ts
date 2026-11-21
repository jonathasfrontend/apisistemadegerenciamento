import { Router, type Request, type Response, type NextFunction } from 'express';
import * as authController from './auth.controller';
import { authenticate } from '../../../middlewares/auth.jwt';
import { validateZod } from '../../../middlewares/validate';
import { AppError } from '../../../middlewares/error.handler';
import { z } from 'zod';

const router = Router();

// Validation schemas
const loginSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

const registerSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  name: z.string().min(2, 'Name must be at least 2 characters'),
  role: z.enum(['ADMIN', 'MANAGER', 'RECEPTION', 'STAFF', 'CLIENT']).optional(),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

// Cadastro público desativado: barra QUALQUER payload antes da validação Zod,
// garantindo 403 consistente mesmo para corpo malformado.
const registerDisabled = (_req: Request, _res: Response, next: NextFunction) => {
  next(new AppError('Cadastro desativado. Solicite ao administrador.', 403));
};

// Routes
router.post('/login', validateZod(loginSchema), authController.login);
router.post('/register', registerDisabled, validateZod(registerSchema), authController.register);
router.post('/refresh', validateZod(refreshSchema), authController.refresh);
router.post('/logout', validateZod(refreshSchema), authController.logout);
router.get('/me', authenticate, authController.me);

export default router;
