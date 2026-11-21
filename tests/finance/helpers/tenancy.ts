/**
 * [F0.2d] Fixture de dois tenants no banco de TESTE.
 *
 * Nunca aponta para a .env de produção: o runner injeta DATABASE_URL do
 * container `test-db`. Todos os registros usam sufixo aleatório para permitir
 * reuso do container entre rodadas sem deleteMany.
 */
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcrypt';
import request from 'supertest';
import app from '../../../src/app';
import prisma from '../../../src/config/db';

export interface TenantFixture {
  suffix: string;
  companyAId: string;
  companyBId: string;
  userAId: string;
  tokenA: string;
  tokenB: string;
  paymentAId: string;
  paymentBId: string;
  clientAId: string;
}

async function login(email: string, password: string): Promise<string> {
  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ email, password });

  if (res.status !== 200) {
    throw new Error(`Login da fixture falhou (${res.status}): ${JSON.stringify(res.body)}`);
  }
  const token = res.body?.data?.accessToken;
  if (!token) throw new Error('accessToken ausente no login da fixture');
  return token;
}

export async function seedTwoTenants(): Promise<TenantFixture> {
  const suffix = randomBytes(6).toString('hex');
  const password = 'teste123';

  // permissão mínima para o papel usado nos testes
  const permission = await prisma.permission.upsert({
    where: { name: 'payments.read' },
    update: {},
    create: { name: 'payments.read', description: 'Visualizar pagamentos', module: 'payments' },
  });

  const role = await prisma.role.create({
    data: {
      name: `Admin-${suffix}`,
      isSystem: false,
      isActive: true,
      rolePermissions: { create: { permissionId: permission.id } },
    },
  });

  const companyA = await prisma.company.create({ data: { name: `Tenant A ${suffix}` } });
  const companyB = await prisma.company.create({ data: { name: `Tenant B ${suffix}` } });

  const passwordHash = await bcrypt.hash(password, 4);
  const userA = await prisma.user.create({
    data: {
      email: `tenant-a-${suffix}@test.local`,
      passwordHash,
      name: 'Usuário A',
      roleId: role.id,
      companyId: companyA.id,
    },
  });
  const userB = await prisma.user.create({
    data: {
      email: `tenant-b-${suffix}@test.local`,
      passwordHash,
      name: 'Usuário B',
      roleId: role.id,
      companyId: companyB.id,
    },
  });

  const clientA = await prisma.client.create({
    data: { name: `Cliente A ${suffix}`, phone: `119${suffix.slice(0, 9)}` },
  });
  const clientB = await prisma.client.create({
    data: { name: `Cliente B ${suffix}`, phone: `219${suffix.slice(0, 9)}` },
  });

  const paymentA = await prisma.payment.create({
    data: {
      companyId: companyA.id,
      clientId: clientA.id,
      amount: 100,
      method: 'PIX',
      status: 'PAID',
    },
  });
  const paymentB = await prisma.payment.create({
    data: {
      companyId: companyB.id,
      clientId: clientB.id,
      amount: 200,
      method: 'PIX',
      status: 'PAID',
    },
  });

  return {
    suffix,
    companyAId: companyA.id,
    companyBId: companyB.id,
    userAId: userA.id,
    tokenA: await login(userA.email, password),
    tokenB: await login(userB.email, password),
    paymentAId: paymentA.id,
    paymentBId: paymentB.id,
    clientAId: clientA.id,
  };
}
