/**
 * [F0.2d] Isolamento multiempresa — gate de segurança da Fase 0.
 *
 * Roda somente contra o banco de teste (docker-compose.test.yml).
 * Cada teste ataca uma das 4 classes de vazamento: listagem, getById,
 * escrita com companyId forjado no body e ausência de contexto no usuário.
 */
import request from 'supertest';
import app from '../../../src/app';
import prisma from '../../../src/config/db';
import { seedTwoTenants, TenantFixture } from '../helpers/tenancy';

describe('tenant isolation (finance F0.2)', () => {
  let fixture: TenantFixture;

  beforeAll(async () => {
    fixture = await seedTwoTenants();
  }, 60_000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('1. listagem de A não contém nenhum pagamento de B', async () => {
    const res = await request(app)
      .get('/api/v1/payments')
      .set('Authorization', `Bearer ${fixture.tokenA}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    const ids = res.body.data.map((p: { id: string }) => p.id);
    expect(ids).toContain(fixture.paymentAId);
    expect(ids).not.toContain(fixture.paymentBId);
    for (const payment of res.body.data) {
      expect(payment.companyId).toBe(fixture.companyAId);
    }
  });

  it('2. getById de pagamento de B com token A retorna 404', async () => {
    const res = await request(app)
      .get(`/api/v1/payments/${fixture.paymentBId}`)
      .set('Authorization', `Bearer ${fixture.tokenA}`);

    expect(res.status).toBe(404);
    expect(res.body?.data).toBeUndefined();
  });

  it('3. POST ignora companyId do body e usa o do usuário', async () => {
    const res = await request(app)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${fixture.tokenA}`)
      .send({
        companyId: fixture.companyBId, // tentativa de escalada cross-tenant
        clientId: fixture.clientAId,
        amount: 50,
        method: 'CASH',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.payment.companyId).toBe(fixture.companyAId);
    expect(res.body.data.payment.companyId).not.toBe(fixture.companyBId);
  });

  it('4. usuário sem empresa no banco recebe 401 no guard do authenticate', async () => {
    // A coluna é NOT NULL: o cenário é simulado no retorno do recarregamento
    // do usuário feito pelo middleware (fonte de autoridade).
    const spy = jest.spyOn(prisma.user, 'findUnique').mockResolvedValueOnce({
      id: fixture.userAId,
      isActive: true,
      companyId: null,
      role: {
        name: 'Admin',
        rolePermissions: [{ permission: { name: 'payments.read' } }],
      },
    } as never);

    try {
      const res = await request(app)
        .get('/api/v1/payments')
        .set('Authorization', `Bearer ${fixture.tokenA}`);

      expect(res.status).toBe(401);
      expect(res.body.message).toBe('User has no company assigned');
    } finally {
      spy.mockRestore();
    }
  });
});
