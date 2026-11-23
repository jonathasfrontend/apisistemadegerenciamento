import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

export class AppError extends Error {
  statusCode: number;
  isOperational: boolean;
  /** [F1.2] Código estável para o cliente (ex.: CASH_SESSION_ALREADY_OPEN). */
  code?: string;

  // Terceiro argumento opcional: todos os chamadores existentes seguem válidos.
  constructor(message: string, statusCode: number = 500, code?: string) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    if (code) this.code = code;

    Error.captureStackTrace(this, this.constructor);
  }
}

export const errorHandler = (
  err: Error | AppError,
  req: Request,
  res: Response,
  _next: NextFunction
) => {
  if (err instanceof AppError) {
    logger.error(`AppError: ${err.message}`, {
      statusCode: err.statusCode,
      path: req.path,
      method: req.method,
    });

    return res.status(err.statusCode).json({
      status: 'error',
      message: err.message,
      ...(err.code ? { code: err.code } : {}),
    });
  }

  // Prisma Errors
  if (err.name === 'PrismaClientKnownRequestError') {
    logger.error(`Prisma Error: ${err.message}`);
    return res.status(400).json({
      status: 'error',
      message: 'Database operation failed',
    });
  }

  // JWT Errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      status: 'error',
      message: 'Invalid token',
    });
  }

  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({
      status: 'error',
      message: 'Token expired',
    });
  }

  // Unknown errors
  logger.error(`Unhandled Error: ${err.message}`, {
    stack: err.stack,
    path: req.path,
    method: req.method,
  });

  return res.status(500).json({
    status: 'error',
    message: process.env.NODE_ENV === 'production' 
      ? 'Internal server error' 
      : err.message,
  });
};

export const asyncHandler = (fn: Function) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
