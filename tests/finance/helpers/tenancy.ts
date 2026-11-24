/**
 * [F0.2d / 0B.1.2] Fixture de dois tenants no banco de TESTE.
 *
 * Nunca aponta para a .env de produção: o runner injeta DATABASE_URL do
 * container `test-db`. Todos os registros usam sufixo aleatório para permitir
 * reuso do container entre rodadas sem deleteMany.
 *
 * 0B.1.2: clients/serviços/produtos/reviews/waitlist agora recebem companyId
 * (colunas NOT NULL após a migration 0B). O papel da fixture recebe
 * permissões de todos os domínios exercitados nos testes de isolamento.
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
  clientBId: string;
  serviceAId: string;
  serviceBId: string;
  productAId: string;
  productBId: string;
  reviewAId: string;
  reviewBId: string;
  waitlistAId: string;
  waitlistBId: string;
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

const TEST_PERMISSIONS = [
  'payments.read', 'payments.create', 'payments.update',
  'clients.read', 'clients.create', 'clients.update', 'clients.delete', 'clients.export',
  'services.read', 'services.create', 'services.update', 'services.delete',
  'products.read', 'products.create', 'products.update', 'products.delete',
  'staff.read', 'staff.create', 'staff.update', 'staff.delete',
  'appointments.read', 'appointments.create', 'appointments.update', 'appointments.delete',
  'reviews.read', 'waitlist.read', 'waitlist.create',
  'reports.read', 'users.list', 'users.read', 'users.create', 'roles.read', 'roles.assign',
  'companies.read', 'companies.create', 'companies.update',
  // F1.1c: o mesmo papel Admin da fixture precisa das permissões financeiras
  // para exercitar os endpoints de cadastro nos testes de integração.
  'finance.dashboard', 'finance.settings', 'finance.catalog.manage',
  'finance.cash.operate', 'finance.bank.view',
  // F1.2: o Admin da fixture também precisa reabrir e ver todos os turnos.
  'finance.cash.view-all', 'finance.cash.reopen',
  // F1.4: a fachada A pagar usa as mesmas 5 permissões do seed de produção.
  'finance.payables.list', 'finance.payables.create', 'finance.payables.update',
  'finance.payables.pay', 'finance.payables.delete',
];

export async function seedTwoTenants(): Promise<TenantFixture> {
  const suffix = randomBytes(6).toString('hex');
  const password = 'teste123';

  // Permissões dos domínios exercitados nos testes de isolamento.
  const permissions = await Promise.all(
    TEST_PERMISSIONS.map((name) =>
      prisma.permission.upsert({
        where: { name },
        update: {},
        create: { name, description: name, module: name.split('.')[0] },
      })
    )
  );

  const role = await prisma.role.create({
    data: {
      name: `Admin-${suffix}`,
      isSystem: false,
      isActive: true,
      rolePermissions: {
        create: permissions.map((permission) => ({ permissionId: permission.id })),
      },
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
    data: { companyId: companyA.id, name: `Cliente A ${suffix}`, phone: `119${suffix.slice(0, 9)}` },
  });
  const clientB = await prisma.client.create({
    data: { companyId: companyB.id, name: `Cliente B ${suffix}`, phone: `219${suffix.slice(0, 9)}` },
  });

  const serviceA = await prisma.service.create({
    data: { companyId: companyA.id, name: `Serviço A ${suffix}`, durationMinutes: 30, price: 50, category: 'cabelo' },
  });
  const serviceB = await prisma.service.create({
    data: { companyId: companyB.id, name: `Serviço B ${suffix}`, durationMinutes: 30, price: 70, category: 'cabelo' },
  });

  const productA = await prisma.product.create({
    data: { companyId: companyA.id, sku: `SKU-A-${suffix}`, name: `Produto A ${suffix}`, category: 'cosmetico', costPrice: 10, salePrice: 20 },
  });
  const productB = await prisma.product.create({
    data: { companyId: companyB.id, sku: `SKU-B-${suffix}`, name: `Produto B ${suffix}`, category: 'cosmetico', costPrice: 30, salePrice: 60 },
  });

  const reviewA = await prisma.review.create({
    data: { companyId: companyA.id, clientId: clientA.id, rating: 5, comment: `Review A ${suffix}` },
  });
  const reviewB = await prisma.review.create({
    data: { companyId: companyB.id, clientId: clientB.id, rating: 1, comment: `Review B ${suffix}` },
  });

  const waitlistA = await prisma.waitlist.create({
    data: { companyId: companyA.id, clientName: `Wait A ${suffix}`, clientPhone: `319${suffix.slice(0, 9)}`, serviceId: serviceA.id },
  });
  const waitlistB = await prisma.waitlist.create({
    data: { companyId: companyB.id, clientName: `Wait B ${suffix}`, clientPhone: `419${suffix.slice(0, 9)}`, serviceId: serviceB.id },
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
    clientBId: clientB.id,
    serviceAId: serviceA.id,
    serviceBId: serviceB.id,
    productAId: productA.id,
    productBId: productB.id,
    reviewAId: reviewA.id,
    reviewBId: reviewB.id,
    waitlistAId: waitlistA.id,
    waitlistBId: waitlistB.id,
  };
}
