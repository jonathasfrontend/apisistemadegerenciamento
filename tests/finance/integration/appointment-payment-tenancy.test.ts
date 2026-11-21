/**
 * [F0B.0] REGRESSÃO — Payment criado por POST /appointments precisa nascer
 * no companyId do usuário autenticado, nunca do body e nunca nulo.
 *
 * Bug de F0: a migration 20261121120100 tornou payments.companyId NOT NULL,
 * mas appointments.service.ts:118-126 cria o Payment sem esse campo →
 * qualquer agendamento novo falha 500 no Neon.
 */
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import app from '../../../src/app';
import prisma from '../../../src/config/db';
import { seedTwoTenants, TenantFixture } from '../helpers/tenancy';

describe('appointment payment tenant scope (F0B.0)', () => {
  let fixture: TenantFixture;
  let staffId: string;

  beforeAll(async () => {
    fixture = await seedTwoTenants();

    const userA = await prisma.user.findUniqueOrThrow({
      where: { id: fixture.userAId },
      select: { roleId: true },
    });
    if (!userA.roleId) throw new Error('Fixture user A sem role');
    const roleId = userA.roleId;
    const permission = await prisma.permission.upsert({
      where: { name: 'appointments.create' },
      update: {},
      create: {
        name: 'appointments.create',
        description: 'Criar agendamentos',
        module: 'appointments',
      },
    });
    const alreadyGranted = await prisma.rolePermission.findFirst({
      where: { roleId, permissionId: permission.id },
    });
    if (!alreadyGranted) {
      await prisma.rolePermission.create({
        data: { roleId, permissionId: permission.id },
      });
    }

    const staff = await prisma.staff.create({
      data: { userId: fixture.userAId, specialties: [] },
    });
    staffId = staff.id;
  }, 60_000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('POST /appointments cria Payment com companyId do usuário e ignora companyId do body', async () => {
    const startTime = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const res = await request(app)
      .post('/api/v1/appointments')
      .set('Authorization', `Bearer ${fixture.tokenA}`)
      .send({
        clientId: fixture.clientAId,
        staffId,
        startTime,
        services: [
          { id: randomUUID(), name: 'Corte', price: 50, duration: 30 },
        ],
        companyId: fixture.companyBId, // escalada cross-tenant
      });

    expect(res.status).toBe(201);

    const appointmentId = res.body?.data?.appointment?.id;
    expect(appointmentId).toBeDefined();

    const payment = await prisma.payment.findFirst({
      where: { appointmentId },
    });
    expect(payment).not.toBeNull();
    expect(payment!.companyId).toBe(fixture.companyAId);
    expect(payment!.companyId).not.toBe(fixture.companyBId);
  });
});
