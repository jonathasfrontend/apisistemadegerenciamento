import { Request, Response, NextFunction } from 'express';
import { AppError } from './error.handler';

/**
 * Autorização para operações em um recurso concreto (`:id`).
 *
 * Libera a operação quando o usuário logado É o dono do recurso
 * (auto-serviço, ex.: alterar a própria senha) OU quando possui a
 * permissão exigida (ex.: administrador alterando a senha de outro).
 *
 * Uso restrito a operações que já exigem a senha atual do alvo —
 * auto-serviço não amplia o que o usuário consegue acessar.
 */
export const allowSelfOrPermission = (paramName: string, ...permissions: string[]) => {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new AppError('Unauthorized', 401));
    }

    const isSelf = req.params[paramName] === req.user.id;

    if (!isSelf) {
      const hasPermission = permissions.some((permission) =>
        req.user!.permissions.includes(permission)
      );

      if (!hasPermission) {
        return next(new AppError('Forbidden - Missing required permission', 403));
      }
    }

    next();
  };
};
