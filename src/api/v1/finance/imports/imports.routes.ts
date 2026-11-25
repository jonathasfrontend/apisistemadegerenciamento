import { NextFunction, Request, Response, Router } from 'express';
import multer from 'multer';
import { env } from '../../../../config/env';
import { authenticate, checkPermission } from '../../../../middlewares/auth.jwt';
import { AppError } from '../../../../middlewares/error.handler';
import { validateZod } from '../../../../middlewares/validate';
import * as controller from './imports.controller';
import {
  importIdSchema,
  listImportRowsSchema,
  listImportsSchema,
  uploadImportSchema,
} from './imports.schemas';

const router = Router();
router.use(authenticate);

/**
 * Upload multipart (campo `file`) em memória.
 *
 * O teto do multer é o maior limite entre OFX e PDF (o limite por formato é
 * refinado no service, que conhece o conteúdo). Erro de tamanho do multer
 * vira 413 `IMPORT_TOO_LARGE` — o mesmo código do limite por formato.
 */
const uploadFile = (req: Request, res: Response, next: NextFunction) => {
  const maxBytes = Math.max(env.financeMaxOfxMb, env.financeMaxPdfMb) * 1024 * 1024;
  const instance = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxBytes },
  });

  instance.single('file')(req, res, (error: unknown) => {
    if (!error) return next();

    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        return next(
          new AppError('Arquivo excede o tamanho máximo permitido', 413, 'IMPORT_TOO_LARGE')
        );
      }
      return next(
        new AppError('Falha ao processar o upload do arquivo', 400, 'IMPORT_UPLOAD_FAILED')
      );
    }

    return next(error as Error);
  });
};

router.post(
  '/',
  checkPermission('finance.bank.import'),
  uploadFile,
  validateZod(uploadImportSchema),
  controller.upload
);
router.get('/', checkPermission('finance.bank.import'), validateZod(listImportsSchema), controller.list);
router.get(
  '/:id/rows',
  checkPermission('finance.bank.import'),
  validateZod(listImportRowsSchema),
  controller.rows
);
router.get(
  '/:id',
  checkPermission('finance.bank.import'),
  validateZod(importIdSchema),
  controller.getById
);

export default router;
