import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { randomBytes, createHash } from 'crypto';
import { env } from '../../../config/env';
import prisma from '../../../config/db';
import { AppError } from '../../../middlewares/error.handler';
import { logger } from '../../../utils/logger';

interface LoginInput {
  email: string;
  password: string;
}

interface AuthResponse {
  user: {
    id: string;
    email: string;
    name: string;
    role: string;
    permissions: string[];
  };
  accessToken: string;
  refreshToken: string;
}

export class AuthService {
  async login(input: LoginInput): Promise<AuthResponse> {
    const { email, password } = input;

    // 0B.1: email é unique composto [companyId, email]. O login público não
    // recebe empresa; findFirst por email seria não determinístico quando duas
    // empresas usam o mesmo endereço. Fail-closed: só autentica se houver
    // exatamente um candidato (sem revelar quantos/onde estão os demais).
    const candidates: any[] = await prisma.user.findMany({
      where: { email: email.toLowerCase() },
      include: {
        role: {
          include: {
            rolePermissions: {
              include: {
                permission: true,
              },
            },
          },
        },
      } as any,
    });

    const user = candidates.length === 1 ? candidates[0] : null;

    if (!user || !user.isActive) {
      throw new AppError('Invalid credentials', 401);
    }

    if (!user.role) {
      throw new AppError('User has no role assigned', 401);
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);

    if (!isPasswordValid) {
      throw new AppError('Invalid credentials', 401);
    }

    // Extract permissions
    const permissions = user.role.rolePermissions.map((rp: any) => rp.permission.name);

    // Generate tokens
    const accessToken = this.generateAccessToken({
      sub: user.id,
      role: user.role.name,
      permissions,
      companyId: user.companyId,
    });

    const refreshToken = await this.generateRefreshToken(user.id, user.companyId);

    // Update last login
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    });

    logger.info(`User ${user.email} logged in successfully`);

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role.name,
        permissions,
      },
      accessToken,
      refreshToken,
    };
  }

  async refresh(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    const tokenHash = this.hashToken(refreshToken);

    const storedToken: any = await prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { 
        user: {
          include: {
            role: {
              include: {
                rolePermissions: {
                  include: {
                    permission: true,
                  },
                },
              },
            },
          },
        },
      } as any,
    });

    if (!storedToken || storedToken.revoked || storedToken.expiresAt < new Date()) {
      throw new AppError('Invalid or expired refresh token', 401);
    }

    if (!storedToken.user.isActive) {
      throw new AppError('User is inactive', 401);
    }

    if (!storedToken.user.role) {
      throw new AppError('User has no role assigned', 401);
    }

    // Extract permissions
    const permissions = storedToken.user.role.rolePermissions.map((rp: any) => rp.permission.name);

    // Revoke old refresh token
    await prisma.refreshToken.update({
      where: { id: storedToken.id },
      data: { revoked: true },
    });

    // Generate new tokens
    const newAccessToken = this.generateAccessToken({
      sub: storedToken.user.id,
      role: storedToken.user.role.name,
      permissions,
      companyId: storedToken.user.companyId,
    });

    const newRefreshToken = await this.generateRefreshToken(storedToken.user.id, storedToken.user.companyId);

    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
    };
  }

  async logout(refreshToken: string, companyId?: string): Promise<void> {
    const tokenHash = this.hashToken(refreshToken);

    // 0B.1: companyId é opcional porque /auth/logout é pública; quando presente,
    // escopa a revogação para não tocar tokens de outra empresa.
    await prisma.refreshToken.updateMany({
      where: { tokenHash, ...(companyId ? { companyId } : {}) },
      data: { revoked: true },
    });

    logger.info('User logged out successfully');
  }

  async register(input: {
    email: string;
    password: string;
    name: string;
    roleId?: string;
  }): Promise<AuthResponse> {
    const { email, password, name, roleId } = input;

    // Check if user exists
    const existingUser = await prisma.user.findFirst({
      where: { email: email.toLowerCase() },
    });

    if (existingUser) {
      throw new AppError('Email already registered', 400);
    }

    // Se roleId não for fornecido, buscar role "Recepção" como padrão
    let finalRoleId = roleId;
    if (!finalRoleId) {
      const defaultRole: any = await (prisma as any).role.findUnique({
        where: { name: 'Recepção' },
      });
      
      if (!defaultRole) {
        throw new AppError('Default role not found', 500);
      }
      
      finalRoleId = defaultRole.id;
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);

    // Registro é rota pública: vincular à única empresa ativa.
    // Multiempresa em registro não existe — ver AUDIT §13 (adaptação F0.2).
    const companies: any[] = await (prisma as any).company.findMany({
      where: { isActive: true },
      select: { id: true },
    });
    if (companies.length === 0) {
      throw new AppError('No company provisioned', 500);
    }
    if (companies.length > 1) {
      throw new AppError('Multiple companies provisioned; explicit registration flow required', 400);
    }
    const company = companies[0];

    // Create user
    const user: any = await prisma.user.create({
      data: {
        email: email.toLowerCase(),
        passwordHash,
        name,
        roleId: finalRoleId,
        companyId: company.id,
      } as any,
      include: {
        role: {
          include: {
            rolePermissions: {
              include: {
                permission: true,
              },
            },
          },
        },
      } as any,
    });

    if (!user.role) {
      throw new AppError('User role not found', 500);
    }

    // Extract permissions
    const permissions = user.role.rolePermissions.map((rp: any) => rp.permission.name);

    // Generate tokens
    const accessToken = this.generateAccessToken({
      sub: user.id,
      role: user.role.name,
      permissions,
      companyId: user.companyId,
    });

    const refreshToken = await this.generateRefreshToken(user.id, user.companyId);

    logger.info(`New user registered: ${user.email}`);

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role.name,
        permissions,
      },
      accessToken,
      refreshToken,
    };
  }

  private generateAccessToken(payload: { sub: string; role: string; permissions: string[]; companyId: string }): string {
    return jwt.sign(payload, env.jwtSecret as string, {
      expiresIn: env.jwtAccessExpiration,
    } as jwt.SignOptions);
  }

  private async generateRefreshToken(userId: string, companyId: string): Promise<string> {
    const token = randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(token);

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30); // 30 days

    await prisma.refreshToken.create({
      data: {
        userId,
        companyId,
        tokenHash,
        expiresAt,
      },
    });

    return token;
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
