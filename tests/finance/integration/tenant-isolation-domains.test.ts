/**
 * [0B.1.2] Isolamento multiempresa — serviços de domínio.
 *
 * Complementa `tenant-isolation.test.ts` (F0.2, financeiro). Aqui cada domínio
 * de negócio é atacado com um tenant alheio: listagem vazada, leitura/escrita
 * cross-tenant (deve ser 404), companyId forjado no body (deve ser ignorado) e
 * uniques compostos (mesmo valor natural aceito nas duas empresas).
 *
 * Roda somente contra o banco de teste (docker-compose.test.yml).
 */
import request from 'supertest';
import app from '../../../src/app';
import prisma from '../../../src/config/db';
import { seedTwoTenants, TenantFixture } from '../helpers/tenancy';

describe('tenant isolation — domínios (0B.1.2)', () => {
  let fixture: TenantFixture;
  const authA = () => `Bearer ${fixture.tokenA}`;
  const authB = () => `Bearer ${fixture.tokenB}`;

  beforeAll(async () => {
    fixture = await seedTwoTenants();
  }, 60_000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const leaks = (body: unknown, leakedId: string) => JSON.stringify(body).includes(leakedId);

  describe('clients', () => {
    it('listagem de A não contém cliente de B', async () => {
      const res = await request(app).get('/api/v1/clients').set('Authorization', authA());
      expect(res.status).toBe(200);
      expect(leaks(res.body, fixture.clientBId)).toBe(false);
    });

    it('A não lê cliente de B (404)', async () => {
      const res = await request(app).get(`/api/v1/clients/${fixture.clientBId}`).set('Authorization', authA());
      expect(res.status).toBe(404);
    });

    it('A não edita cliente de B (404)', async () => {
      const res = await request(app)
        .put(`/api/v1/clients/${fixture.clientBId}`)
        .set('Authorization', authA())
        .send({ name: 'Invadido' });
      expect(res.status).toBe(404);
    });

    it('A não apaga cliente de B (404)', async () => {
      const res = await request(app).delete(`/api/v1/clients/${fixture.clientBId}`).set('Authorization', authA());
      expect(res.status).toBe(404);
    });

    it('companyId forjado no body é ignorado', async () => {
      const res = await request(app)
        .post('/api/v1/clients')
        .set('Authorization', authA())
        .send({ name: 'Cliente Forjado', phone: `519${fixture.suffix.slice(0, 9)}`, companyId: fixture.companyBId });
      expect(res.status).toBe(201);
      expect(res.body.data.client.companyId).toBe(fixture.companyAId);
    });

    it('mesmo telefone é aceito nas duas empresas (unique composto)', async () => {
      const phone = `119${fixture.suffix.slice(0, 9)}`; // já usado por clientA
      const res = await request(app)
        .post('/api/v1/clients')
        .set('Authorization', authB())
        .send({ name: 'Cliente B mesmo fone', phone });
      expect(res.status).toBe(201);
      expect(res.body.data.client.companyId).toBe(fixture.companyBId);
    });
  });

  describe('services', () => {
    it('listagem de A não contém serviço de B', async () => {
      const res = await request(app).get('/api/v1/services').set('Authorization', authA());
      expect(res.status).toBe(200);
      expect(leaks(res.body, fixture.serviceBId)).toBe(false);
    });

    it('A não lê serviço de B (404)', async () => {
      const res = await request(app).get(`/api/v1/services/${fixture.serviceBId}`).set('Authorization', authA());
      expect(res.status).toBe(404);
    });
  });

  describe('products', () => {
    it('listagem de A não contém produto de B', async () => {
      const res = await request(app).get('/api/v1/products').set('Authorization', authA());
      expect(res.status).toBe(200);
      expect(leaks(res.body, fixture.productBId)).toBe(false);
    });

    it('A não lê produto de B (404)', async () => {
      const res = await request(app).get(`/api/v1/products/${fixture.productBId}`).set('Authorization', authA());
      expect(res.status).toBe(404);
    });

    it('mesmo SKU é aceito nas duas empresas (unique composto)', async () => {
      const sku = `SKU-A-${fixture.suffix}`; // já usado por productA
      const res = await request(app)
        .post('/api/v1/products')
        .set('Authorization', authB())
        .send({ sku, name: 'Produto B mesmo SKU', category: 'cosmetico', quantity: 0, costPrice: 1, salePrice: 2 });
      expect(res.status).toBe(201);
      expect(res.body.data.product.companyId).toBe(fixture.companyBId);
    });
  });

  describe('reviews', () => {
    it('listagem de A não contém review de B', async () => {
      const res = await request(app).get('/api/v1/reviews').set('Authorization', authA());
      expect(res.status).toBe(200);
      expect(leaks(res.body, fixture.reviewBId)).toBe(false);
    });
  });

  describe('waitlist', () => {
    it('listagem de A não contém item de B', async () => {
      const res = await request(app).get('/api/v1/waitlist').set('Authorization', authA());
      expect(res.status).toBe(200);
      expect(leaks(res.body, fixture.waitlistBId)).toBe(false);
    });

    it('A não lê item de lista de B (404)', async () => {
      const res = await request(app).get(`/api/v1/waitlist/${fixture.waitlistBId}`).set('Authorization', authA());
      expect(res.status).toBe(404);
    });
  });
});
