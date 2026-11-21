/**
 * [Review F0B.1] Validação de referências cross-tenant.
 *
 * O threading de `companyId` escopa as linhas criadas/lidas, mas uma FK para
 * id alheio ainda era aceita: o registro novo ficava no tenant correto enquanto
 * apontava para cliente/serviço/profissional de outro. Este teste ataca essa
 * fronteira — referência de B Must Be rejeitada por A antes de qualquer escrita.
 *
 * Roda somente contra o banco de teste (docker-compose.test.yml).
 */
import bcrypt from 'bcrypt';
import request from 'supertest';
import app from '../../../src/app';
import prisma from '../../../src/config/db';
import { seedTwoTenants, TenantFixture } from '../helpers/tenancy';

describe('tenant isolation — referências (review F0B.1)', () => {
  let fixture: TenantFixture;
  let roleId: string;
  let staffAId: string;
  let staffBId: string;
  let appointmentAId: string;
  let userBId: string;
  let otherRoleId: string;

  const authA = () => `Bearer ${fixture.tokenA}`;

  beforeAll(async () => {
    fixture = await seedTwoTenants();
    const userA = await prisma.user.findFirst({ where: { companyId: fixture.companyAId } });
    const userB = await prisma.user.findFirst({ where: { companyId: fixture.companyBId } });
    if (!userA || !userB || !userA.roleId) throw new Error('Fixture de usuários ausente');
    userBId = userB.id;
    roleId = userA.roleId;

    const otherRole = await prisma.role.create({
      data: { name: `Other-${fixture.suffix}`, isSystem: false, isActive: true },
    });
    otherRoleId = otherRole.id;

    // Produto de A precisa de estoque: sem isso a venda falharia por estoque
    // e o teste passaria por motivo errado (falso-positivo).
    await prisma.product.update({
      where: { id: fixture.productAId },
      data: { quantity: 10 },
    });

    const staffA = await prisma.staff.create({
      data: { companyId: fixture.companyAId, userId: userA.id },
    });
    const staffB = await prisma.staff.create({
      data: { companyId: fixture.companyBId, userId: userB.id },
    });
    staffAId = staffA.id;
    staffBId = staffB.id;

    const start = new Date('2030-01-15T13:00:00.000Z');
    const end = new Date('2030-01-15T14:00:00.000Z');
    const appointmentA = await prisma.appointment.create({
      data: {
        companyId: fixture.companyAId,
        clientId: fixture.clientAId,
        staffId: staffAId,
        startTime: start,
        endTime: end,
        services: [],
        createdBy: userA.id,
      },
    });
    appointmentAId = appointmentA.id;
  }, 60_000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('payments: A não cria pagamento com clientId de B', async () => {
    const res = await request(app)
      .post('/api/v1/payments')
      .set('Authorization', authA())
      .send({ clientId: fixture.clientBId, amount: 12.5, method: 'PIX' });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(
      await prisma.payment.count({ where: { companyId: fixture.companyAId, amount: 12.5 } })
    ).toBe(0);
  });

  it('payments: A não vincula pagamento a appointmentId de B', async () => {
    const apptB = await prisma.appointment.create({
      data: {
        companyId: fixture.companyBId,
        clientId: fixture.clientBId,
        staffId: staffBId,
        startTime: new Date('2030-02-15T13:00:00.000Z'),
        endTime: new Date('2030-02-15T14:00:00.000Z'),
        services: [],
        createdBy: userBId,
      },
    });
    const res = await request(app)
      .post('/api/v1/payments')
      .set('Authorization', authA())
      .send({ clientId: fixture.clientAId, appointmentId: apptB.id, amount: 33.5, method: 'PIX' });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(
      await prisma.payment.count({ where: { companyId: fixture.companyAId, amount: 33.5 } })
    ).toBe(0);
  });

  it('reviews: A não cria review com clientId de B', async () => {
    const res = await request(app)
      .post('/api/v1/reviews')
      .set('Authorization', authA())
      .send({ clientId: fixture.clientBId, rating: 5, comment: `cross-${fixture.suffix}` });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(
      await prisma.review.count({
        where: { companyId: fixture.companyAId, comment: `cross-${fixture.suffix}` },
      })
    ).toBe(0);
  });

  it('sales: A não cria venda com clientId de B', async () => {
    const res = await request(app)
      .post('/api/v1/sales')
      .set('Authorization', authA())
      .send({
        clientId: fixture.clientBId,
        paymentMethod: 'PIX',
        items: [{ productId: fixture.productAId, quantity: 1, unitPrice: 10 }],
      });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(
      await prisma.sale.count({ where: { companyId: fixture.companyAId, totalAmount: 10 } })
    ).toBe(0);
  });

  it('waitlist: A não cria entrada com serviceId de B', async () => {
    const res = await request(app)
      .post('/api/v1/waitlist')
      .set('Authorization', authA())
      .send({
        clientName: `Cross ${fixture.suffix}`,
        clientPhone: `619${fixture.suffix.slice(0, 9)}`,
        serviceId: fixture.serviceBId,
      });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(
      await prisma.waitlist.count({
        where: { companyId: fixture.companyAId, serviceId: fixture.serviceBId },
      })
    ).toBe(0);
  });

  it('appointments: A não reatribui agendamento a staff de B', async () => {
    const res = await request(app)
      .put(`/api/v1/appointments/${appointmentAId}`)
      .set('Authorization', authA())
      .send({ staffId: staffBId });
    expect(res.status).toBeGreaterThanOrEqual(400);
    const stored = await prisma.appointment.findFirst({ where: { id: appointmentAId } });
    expect(stored?.staffId).toBe(staffAId);
  });

  it('roles: A não atribui cargo a usuário de B', async () => {
    const res = await request(app)
      .post(`/api/v1/roles/${otherRoleId}/assign/${userBId}`)
      .set('Authorization', authA());
    expect(res.status).toBeGreaterThanOrEqual(400);
    const stored = await prisma.user.findFirst({ where: { id: userBId } });
    expect(stored?.roleId).toBe(roleId);
  });

  it('login: email duplicado entre tenants é rejeitado (fail-closed)', async () => {
    const email = `dup-${fixture.suffix}@test.local`;
    const passwordHash = await bcrypt.hash('teste123', 4);
    for (const companyId of [fixture.companyAId, fixture.companyBId]) {
      await prisma.user.create({
        data: { companyId, email, passwordHash, name: `Dup ${companyId}`, roleId },
      });
    }
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password: 'teste123' });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
