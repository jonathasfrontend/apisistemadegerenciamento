/**
 * [F1.1c] CRUD de cadastros financeiros — settings, categorias, fornecedores,
 * contas bancárias, maquininhas e caixas registradas.
 *
 * Roda somente contra o banco de teste (docker-compose.test.yml). Cobertura:
 * isolamento por empresa (cross-tenant 404), RBAC (403), regras de categoria
 * (system/in-use/kind), normalização de bankKeywords, saldo F1 e paginação.
 */
import bcrypt from 'bcrypt';
import request from 'supertest';
import app from '../../../src/app';
import prisma from '../../../src/config/db';
import { seedCompanyFinance } from '../../../prisma/seed.finance';
import { seedTwoTenants, TenantFixture } from '../helpers/tenancy';

const BASE = '/api/v1/finance';

describe('finance catalog CRUD (finance F1.1c)', () => {
  let fixture: TenantFixture;
  let tokenNoPermission: string;

  const auth = () => `Bearer ${fixture.tokenA}`;
  const authB = () => `Bearer ${fixture.tokenB}`;

  beforeAll(async () => {
    fixture = await seedTwoTenants();

    // Toda empresa da fixture precisa da base financeira (settings, caixa e
    // 21 categorias sistema) para que os testes de system/in-use sejam reais.
    await seedCompanyFinance(prisma, fixture.companyAId);
    await seedCompanyFinance(prisma, fixture.companyBId);

    const role = await prisma.role.create({
      data: { name: `SemFin-${fixture.suffix}`, isSystem: false, isActive: true },
    });
    const passwordHash = await bcrypt.hash('teste123', 4);
    const user = await prisma.user.create({
      data: {
        email: `semfin-${fixture.suffix}@test.local`,
        passwordHash,
        name: 'Sem permissão financeira',
        roleId: role.id,
        companyId: fixture.companyAId,
      },
    });
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'teste123' });
    if (login.status !== 200) {
      throw new Error(`Login sem-permissão falhou (${login.status}): ${JSON.stringify(login.body)}`);
    }
    tokenNoPermission = login.body.data.accessToken;
  }, 60_000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // ---------------------------------------------------------------- settings

  it('1. GET /settings returns defaults for Admin', async () => {
    const res = await request(app).get(`${BASE}/settings`).set('Authorization', auth());

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.data.requireOpenCashSession).toBe(true);
    expect(res.body.data.enableOverdueAlerts).toBe(true);
    expect(res.body.data.matchWindowDays).toBe(3);
  });

  it('2. PUT /settings updates values and keeps the tenant', async () => {
    const res = await request(app)
      .put(`${BASE}/settings`)
      .set('Authorization', auth())
      .send({ requireOpenCashSession: false, matchWindowDays: 7, enableOverdueAlerts: false });

    expect(res.status).toBe(200);
    expect(res.body.data.requireOpenCashSession).toBe(false);
    expect(res.body.data.matchWindowDays).toBe(7);
    expect(res.body.data.enableOverdueAlerts).toBe(false);
    expect(res.body.data.companyId).toBe(fixture.companyAId);

    const stored = await prisma.financeSettings.findUnique({
      where: { companyId: fixture.companyAId },
    });
    expect(stored!.matchWindowDays).toBe(7);
  });

  it('3. settings endpoints are 403 without finance.settings', async () => {
    const get = await request(app)
      .get(`${BASE}/settings`)
      .set('Authorization', `Bearer ${tokenNoPermission}`);
    const put = await request(app)
      .put(`${BASE}/settings`)
      .set('Authorization', `Bearer ${tokenNoPermission}`)
      .send({ matchWindowDays: 9 });

    expect(get.status).toBe(403);
    expect(put.status).toBe(403);
  });

  // -------------------------------------------------------------- categories

  it('4. POST /categories creates a tenant-scoped category', async () => {
    const res = await request(app)
      .post(`${BASE}/categories`)
      .set('Authorization', auth())
      .send({ name: `Categoria ${fixture.suffix}`, kind: 'EXPENSE', color: '#abc', sortOrder: 2 });

    expect(res.status).toBe(201);
    expect(res.body.data.companyId).toBe(fixture.companyAId);
    expect(res.body.data.isSystem).toBe(false);
    expect(res.body.data.isActive).toBe(true);
  });

  it('5. GET /categories paginates, filters isActive and sorts desc', async () => {
    const seed = await prisma.financialCategory.create({
      data: {
        companyId: fixture.companyAId,
        name: `ZZZ ${fixture.suffix}`,
        kind: 'EXPENSE',
        isActive: false,
      },
    });
    const res = await request(app)
      .get(`${BASE}/categories?page=1&limit=5&isActive=false&sort=name:desc`)
      .set('Authorization', auth());

    expect(res.status).toBe(200);
    expect(res.body.pagination).toMatchObject({ page: 1, limit: 5 });
    expect(res.body.pagination.total).toEqual(expect.any(Number));
    expect(res.body.pagination.totalPages).toEqual(expect.any(Number));
    expect(res.body.data.some((c: { id: string }) => c.id === seed.id)).toBe(true);
    expect(res.body.data.every((c: { isActive: boolean }) => c.isActive === false)).toBe(true);

    const capped = await request(app)
      .get(`${BASE}/categories?limit=1000`)
      .set('Authorization', auth());
    expect(capped.body.pagination.limit).toBe(100);
  });

  it('6. PUT /categories/:id changes isActive but rejects kind on a system category', async () => {
    const system = await prisma.financialCategory.findFirstOrThrow({
      where: { companyId: fixture.companyAId, isSystem: true },
    });

    const toggled = await request(app)
      .put(`${BASE}/categories/${system.id}`)
      .set('Authorization', auth())
      .send({ isActive: false });
    expect(toggled.status).toBe(200);
    expect(toggled.body.data.isActive).toBe(false);

    const wrongKind = await request(app)
      .put(`${BASE}/categories/${system.id}`)
      .set('Authorization', auth())
      .send({ kind: system.kind === 'EXPENSE' ? 'INCOME' : 'EXPENSE' });
    expect(wrongKind.status).toBe(422);
  });

  it('7. DELETE /categories/:id rejects a system category with 409', async () => {
    const system = await prisma.financialCategory.findFirstOrThrow({
      where: { companyId: fixture.companyAId, isSystem: true },
    });
    const res = await request(app)
      .delete(`${BASE}/categories/${system.id}`)
      .set('Authorization', auth());

    expect(res.status).toBe(409);
  });

  it('8. DELETE /categories/:id in use returns 409 CATEGORY_IN_USE with a count', async () => {
    const category = await prisma.financialCategory.create({
      data: { companyId: fixture.companyAId, name: `EmUso ${fixture.suffix}`, kind: 'EXPENSE' },
    });
    for (const n of [1, 2]) {
      await prisma.expense.create({
        data: {
          companyId: fixture.companyAId,
          categoryId: category.id,
          category: `EmUso ${fixture.suffix}`,
          description: `Uso ${n} ${fixture.suffix}`,
          amount: 10 * n,
          dueDate: new Date('2026-11-01T00:00:00.000Z'),
        },
      });
    }

    const res = await request(app)
      .delete(`${BASE}/categories/${category.id}`)
      .set('Authorization', auth());

    expect(res.status).toBe(409);
    expect(res.body.message).toContain('CATEGORY_IN_USE');
    expect(res.body.message).toContain('2');
  });

  it('9. DELETE /categories/:id removes an unused user category', async () => {
    const category = await prisma.financialCategory.create({
      data: { companyId: fixture.companyAId, name: `Livre ${fixture.suffix}`, kind: 'INCOME' },
    });
    const res = await request(app)
      .delete(`${BASE}/categories/${category.id}`)
      .set('Authorization', auth());

    expect([200, 204]).toContain(res.status);
    expect(await prisma.financialCategory.findUnique({ where: { id: category.id } })).toBeNull();
  });

  // --------------------------------------------------------------- suppliers

  it('10. suppliers CRUD works and cross-tenant access is 404', async () => {
    const created = await request(app)
      .post(`${BASE}/suppliers`)
      .set('Authorization', auth())
      .send({ name: `Fornecedor ${fixture.suffix}`, document: '12345678000195', isActive: true });
    expect(created.status).toBe(201);
    const id = created.body.data.id;

    const listed = await request(app)
      .get(`${BASE}/suppliers?page=1&limit=10&isActive=true`)
      .set('Authorization', auth());
    expect(listed.status).toBe(200);
    expect(listed.body.data.some((s: { id: string }) => s.id === id)).toBe(true);

    const updated = await request(app)
      .put(`${BASE}/suppliers/${id}`)
      .set('Authorization', auth())
      .send({ name: `Fornecedor editado ${fixture.suffix}` });
    expect(updated.status).toBe(200);
    expect(updated.body.data.name).toContain('editado');

    const cross = await request(app)
      .get(`${BASE}/suppliers/${id}`)
      .set('Authorization', authB());
    expect(cross.status).toBe(404);

    const removed = await request(app)
      .delete(`${BASE}/suppliers/${id}`)
      .set('Authorization', auth());
    expect([200, 204]).toContain(removed.status);
  });

  // ------------------------------------------------------------ bank accounts

  it('11. POST /bank-accounts requires initialBalance and initialBalanceDate', async () => {
    const res = await request(app)
      .post(`${BASE}/bank-accounts`)
      .set('Authorization', auth())
      .send({ name: `Sem saldo ${fixture.suffix}`, type: 'CHECKING' });

    expect(res.status).toBe(400);
  });

  it('12. bank accounts CRUD + F1 balance returns initialBalance for any asOf', async () => {
    const created = await request(app)
      .post(`${BASE}/bank-accounts`)
      .set('Authorization', auth())
      .send({
        name: `Conta ${fixture.suffix}`,
        bankCode: '001',
        type: 'CHECKING',
        initialBalance: 1234.56,
        initialBalanceDate: '2026-01-10',
      });
    expect(created.status).toBe(201);
    const id = created.body.data.id;

    const before = await request(app)
      .get(`${BASE}/bank-accounts/${id}/balance?asOf=2026-01-01`)
      .set('Authorization', auth());
    const after = await request(app)
      .get(`${BASE}/bank-accounts/${id}/balance?asOf=2026-12-31`)
      .set('Authorization', auth());
    expect(before.status).toBe(200);
    expect(after.status).toBe(200);
    expect(Number(before.body.data.balance)).toBe(1234.56);
    expect(Number(after.body.data.balance)).toBe(1234.56);

    const cross = await request(app)
      .get(`${BASE}/bank-accounts/${id}`)
      .set('Authorization', authB());
    expect(cross.status).toBe(404);

    const updated = await request(app)
      .put(`${BASE}/bank-accounts/${id}`)
      .set('Authorization', auth())
      .send({ bankName: 'Banco do Brasil' });
    expect(updated.status).toBe(200);

    const removed = await request(app)
      .delete(`${BASE}/bank-accounts/${id}`)
      .set('Authorization', auth());
    expect([200, 204]).toContain(removed.status);
  });

  it('13. balance endpoint is 403 without finance.bank.view', async () => {
    const account = await prisma.bankAccount.create({
      data: {
        companyId: fixture.companyAId,
        name: `Saldo sem perm ${fixture.suffix}`,
        initialBalance: 1,
        initialBalanceDate: new Date('2026-01-01T00:00:00.000Z'),
      },
    });
    const res = await request(app)
      .get(`${BASE}/bank-accounts/${account.id}/balance`)
      .set('Authorization', `Bearer ${tokenNoPermission}`);

    expect(res.status).toBe(403);
  });

  // --------------------------------------------------------------- acquirers

  it('14. POST /acquirers requires rates and normalizes bankKeywords', async () => {
    const missing = await request(app)
      .post(`${BASE}/acquirers`)
      .set('Authorization', auth())
      .send({ name: `Sem taxas ${fixture.suffix}` });
    expect(missing.status).toBe(400);

    const created = await request(app)
      .post(`${BASE}/acquirers`)
      .set('Authorization', auth())
      .send({
        name: `Maquininha ${fixture.suffix}`,
        bankKeywords: ['itaú unibanco', 'BB', 'Caixa Econômica'],
        debitRate: 0.0199,
        creditRate: 0.0399,
        installmentRates: { '3': 0.0599, '6': 0.0899 },
      });
    expect(created.status).toBe(201);
    expect(created.body.data.bankKeywords).toEqual(['ITAU UNIBANCO', 'BB', 'CAIXA ECONOMICA']);
    expect(created.body.data.installmentRates).toEqual({ '3': 0.0599, '6': 0.0899 });
    expect(Number(created.body.data.debitRate)).toBeCloseTo(0.0199, 4);
  });

  it('15. acquirers CRUD works and cross-tenant access is 404', async () => {
    const created = await request(app)
      .post(`${BASE}/acquirers`)
      .set('Authorization', auth())
      .send({
        name: `Adquirente ${fixture.suffix}`,
        bankKeywords: [],
        debitRate: 0.01,
        creditRate: 0.02,
      });
    expect(created.status).toBe(201);
    const id = created.body.data.id;

    const updated = await request(app)
      .put(`${BASE}/acquirers/${id}`)
      .set('Authorization', auth())
      .send({ isActive: false });
    expect(updated.status).toBe(200);
    expect(updated.body.data.isActive).toBe(false);

    const cross = await request(app)
      .get(`${BASE}/acquirers/${id}`)
      .set('Authorization', authB());
    expect(cross.status).toBe(404);

    const removed = await request(app)
      .delete(`${BASE}/acquirers/${id}`)
      .set('Authorization', auth());
    expect([200, 204]).toContain(removed.status);
  });

  // ------------------------------------------------------------ cash registers

  it('16. cash registers CRUD, duplicate name 409 and cross-tenant 404', async () => {
    const name = `Caixa ${fixture.suffix}`;
    const created = await request(app)
      .post(`${BASE}/cash/registers`)
      .set('Authorization', auth())
      .send({ name });
    expect(created.status).toBe(201);
    const id = created.body.data.id;

    const duplicate = await request(app)
      .post(`${BASE}/cash/registers`)
      .set('Authorization', auth())
      .send({ name });
    expect(duplicate.status).toBe(409);

    const listed = await request(app)
      .get(`${BASE}/cash/registers?page=1&limit=10`)
      .set('Authorization', auth());
    expect(listed.status).toBe(200);
    expect(listed.body.data.some((r: { id: string }) => r.id === id)).toBe(true);

    const updated = await request(app)
      .put(`${BASE}/cash/registers/${id}`)
      .set('Authorization', auth())
      .send({ isActive: false });
    expect(updated.status).toBe(200);
    expect(updated.body.data.isActive).toBe(false);

    const cross = await request(app)
      .get(`${BASE}/cash/registers/${id}`)
      .set('Authorization', authB());
    expect(cross.status).toBe(404);
  });

  it('17. catalog write endpoints are 403 without finance.catalog.manage', async () => {
    const res = await request(app)
      .post(`${BASE}/categories`)
      .set('Authorization', `Bearer ${tokenNoPermission}`)
      .send({ name: `Negado ${fixture.suffix}`, kind: 'EXPENSE' });

    expect(res.status).toBe(403);
  });
});
