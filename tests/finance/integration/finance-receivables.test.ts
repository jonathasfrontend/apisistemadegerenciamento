/**
 * [F1.5] GET /finance/receivables (união Payment + OtherIncome) e CRUD de
 * receitas avulsas. Roda somente contra o banco de teste. Cobertura: união
 * paginada, resumo sobre lista filtrada (aceite F1.5), filtros, isolamento,
 * RBAC e validação de FKs no tenant (D-F1.48).
 */
import bcrypt from 'bcrypt';
import request from 'supertest';
import app from '../../../src/app';
import prisma from '../../../src/config/db';
import { seedCompanyFinance } from '../../../prisma/seed.finance';
import { seedTwoTenants, TenantFixture } from '../helpers/tenancy';

const RECEIVABLES = '/api/v1/finance/receivables';
const OTHER = '/api/v1/finance/other-incomes';

describe('unified receivables and other incomes (finance F1.5)', () => {
  let fixture: TenantFixture;
  let tokenA: string;
  let tokenB: string;
  let tokenNoPerm: string;
  let categoryAId: string;
  let foreignCategoryId: string;
  let bankAId: string;

  const authA = () => `Bearer ${tokenA}`;
  const authB = () => `Bearer ${tokenB}`;

  async function makeUser(label: string, permissions: string[], companyId: string) {
    const records = await Promise.all(
      permissions.map((name) =>
        prisma.permission.upsert({
          where: { name },
          update: {},
          create: { name, description: name, module: 'finance' },
        })
      )
    );
    const role = await prisma.role.create({
      data: {
        name: `${label}-${fixture.suffix}`,
        isSystem: false,
        isActive: true,
        rolePermissions: { create: records.map((p) => ({ permissionId: p.id })) },
      },
    });
    const user = await prisma.user.create({
      data: {
        email: `${label.toLowerCase()}-${fixture.suffix}@test.local`,
        passwordHash: await bcrypt.hash('teste123', 4),
        name: label,
        roleId: role.id,
        companyId,
      },
    });
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'teste123' });
    if (login.status !== 200) {
      throw new Error(`Login ${label} falhou (${login.status}): ${JSON.stringify(login.body)}`);
    }
    return login.body.data.accessToken as string;
  }

  beforeAll(async () => {
    fixture = await seedTwoTenants();
    // A fixture base cria paymentA(100)/paymentB(200). Remove só esses dois para
    // que as contagens abaixo reflitam exclusivamente os dados desta suíte.
    await prisma.payment.deleteMany({
      where: { id: { in: [fixture.paymentAId, fixture.paymentBId] } },
    });
    await seedCompanyFinance(prisma, fixture.companyAId);
    await seedCompanyFinance(prisma, fixture.companyBId);
    tokenA = fixture.tokenA;
    tokenB = fixture.tokenB;

    tokenA = await makeUser(
      'RecA',
      ['finance.receivables.list', 'finance.catalog.manage'],
      fixture.companyAId
    );
    tokenB = await makeUser('RecB', ['finance.receivables.list'], fixture.companyBId);
    tokenNoPerm = await makeUser('RecNo', ['finance.dashboard'], fixture.companyAId);

    const catA = await prisma.financialCategory.findFirstOrThrow({
      where: { companyId: fixture.companyAId, kind: 'INCOME' },
    });
    categoryAId = catA.id;
    const catB = await prisma.financialCategory.findFirstOrThrow({
      where: { companyId: fixture.companyBId, kind: 'INCOME' },
    });
    foreignCategoryId = catB.id;

    const bank = await prisma.bankAccount.create({
      data: {
        companyId: fixture.companyAId,
        name: `Conta Rec ${fixture.suffix}`,
        initialBalanceDate: new Date('2026-01-01T00:00:00Z'),
      },
    });
    bankAId = bank.id;

    // Pagamento PIX pendente antigo (vencido) da empresa A.
    await prisma.payment.create({
      data: {
        companyId: fixture.companyAId,
        clientId: fixture.clientAId,
        amount: 100,
        method: 'PIX',
        status: 'PENDING',
        createdAt: new Date('2026-10-01T12:00:00Z'),
      },
    });
    // Pagamento PIX pago recente da empresa A.
    await prisma.payment.create({
      data: {
        companyId: fixture.companyAId,
        clientId: fixture.clientAId,
        amount: 250,
        method: 'PIX',
        status: 'PAID',
        paidAt: new Date('2026-11-20T12:00:00Z'),
      },
    });
    // Receita avulsa da empresa A.
    await prisma.otherIncome.create({
      data: {
        companyId: fixture.companyAId,
        description: `Aluguel ${fixture.suffix}`,
        amount: 300,
        receivedAt: new Date('2026-11-15T00:00:00Z'),
        categoryId: categoryAId,
      },
    });
    // Dados da empresa B — nunca devem aparecer para A.
    await prisma.payment.create({
      data: {
        companyId: fixture.companyBId,
        clientId: fixture.clientBId,
        amount: 9999,
        method: 'PIX',
        status: 'PAID',
        paidAt: new Date('2026-11-20T12:00:00Z'),
      },
    });
    await prisma.otherIncome.create({
      data: {
        companyId: fixture.companyBId,
        description: `Receita B ${fixture.suffix}`,
        amount: 8888,
        receivedAt: new Date('2026-11-15T00:00:00Z'),
      },
    });
  }, 120_000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('1. lista unificada: Payment + OtherIncome, isolada por empresa', async () => {
    const res = await request(app).get(RECEIVABLES).set('Authorization', authA());
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    const kinds = res.body.data.map((r: any) => r.kind);
    expect(kinds).toContain('PAYMENT');
    expect(kinds).toContain('OTHER_INCOME');
    expect(res.body.data).toHaveLength(3);
    expect(res.body.data.every((r: any) => r.amount !== 9999 && r.amount !== 8888)).toBe(true);
    expect(res.body.summary).toBeDefined();
    expect(res.body.pagination).toBeDefined();
  });

  it('2. resumo bate com a soma da lista filtrada (aceite F1.5)', async () => {
    const res = await request(app).get(RECEIVABLES).set('Authorization', authA());
    const rows = res.body.data;
    const sum = rows.reduce((s: number, r: any) => s + r.amount, 0);
    expect(res.body.summary.totalExpected).toBe(sum);
  });

  it('3. filtro status=PAID devolve só recebidos e resumo recalculado', async () => {
    const res = await request(app)
      .get(`${RECEIVABLES}?status=PAID`)
      .set('Authorization', authA());
    expect(res.status).toBe(200);
    expect(res.body.data.every((r: any) => r.status === 'PAID')).toBe(true);
    const sum = res.body.data.reduce((s: number, r: any) => s + r.amount, 0);
    expect(res.body.summary.totalExpected).toBe(sum);
  });

  it('4. filtro method=PIX exclui OtherIncome', async () => {
    const res = await request(app)
      .get(`${RECEIVABLES}?method=PIX`)
      .set('Authorization', authA());
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data.every((r: any) => r.method === 'PIX')).toBe(true);
  });

  it('5. filtro isReconciled e período', async () => {
    const rec = await request(app)
      .get(`${RECEIVABLES}?isReconciled=false`)
      .set('Authorization', authA());
    expect(rec.status).toBe(200);
    expect(rec.body.data.every((r: any) => r.isReconciled === false)).toBe(true);

    const period = await request(app)
      .get(`${RECEIVABLES}?from=2026-11-01&to=2026-11-30`)
      .set('Authorization', authA());
    expect(period.status).toBe(200);
    expect(period.body.data.length).toBe(2);
  });

  it('6. paginação funciona sobre a união', async () => {
    const res = await request(app)
      .get(`${RECEIVABLES}?page=2&limit=2&sort=expectedDate:asc`)
      .set('Authorization', authA());
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.pagination.total).toBe(3);
    expect(res.body.pagination.totalPages).toBe(2);
  });

  it('7. isolamento: tenant B vê só os seus recebíveis', async () => {
    const res = await request(app).get(RECEIVABLES).set('Authorization', authB());
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data.every((r: any) => r.amount === 9999 || r.amount === 8888)).toBe(true);
  });

  it('8. RBAC: sem finance.receivables.list → 403', async () => {
    const res = await request(app)
      .get(RECEIVABLES)
      .set('Authorization', `Bearer ${tokenNoPerm}`);
    expect(res.status).toBe(403);
  });

  // --------------------------------------------------------- other-incomes CRUD

  it('9. POST other-incomes cria receita avulsa com envelope 201', async () => {
    const res = await request(app)
      .post(OTHER)
      .set('Authorization', authA())
      .send({
        description: `Reembolso ${fixture.suffix}`,
        amount: 123.45,
        receivedAt: '2026-11-21',
        categoryId: categoryAId,
        bankAccountId: bankAId,
      });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('success');
    expect(res.body.data.description).toContain('Reembolso');
    expect(typeof res.body.data.amount).toBe('number');
    expect(res.body.data.amount).toBe(123.45);
  });

  it('10. GET /:id, PUT e DELETE other-incomes', async () => {
    const created = await request(app)
      .post(OTHER)
      .set('Authorization', authA())
      .send({ description: `Avulsa CRUD ${fixture.suffix}`, amount: 50, receivedAt: '2026-11-22' });
    const id = created.body.data.id;

    const got = await request(app).get(`${OTHER}/${id}`).set('Authorization', authA());
    expect(got.status).toBe(200);
    expect(got.body.data.description).toContain('Avulsa CRUD');

    const upd = await request(app)
      .put(`${OTHER}/${id}`)
      .set('Authorization', authA())
      .send({ amount: 75 });
    expect(upd.status).toBe(200);
    expect(Number(upd.body.data.amount)).toBe(75);

    const del = await request(app).delete(`${OTHER}/${id}`).set('Authorization', authA());
    expect(del.status).toBe(204);
    expect(await prisma.otherIncome.count({ where: { id } })).toBe(0);
  });

  it('11. FK estrangeira em other-incomes é 404 (D-F1.48)', async () => {
    const res = await request(app)
      .post(OTHER)
      .set('Authorization', authA())
      .send({
        description: `FK ruim ${fixture.suffix}`,
        amount: 10,
        receivedAt: '2026-11-22',
        categoryId: foreignCategoryId,
      });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('CATEGORY_NOT_FOUND');
  });

  it('12. RBAC: escrita sem finance.catalog.manage → 403', async () => {
    const res = await request(app)
      .post(OTHER)
      .set('Authorization', `Bearer ${tokenNoPerm}`)
      .send({ description: 'sem permissão', amount: 10, receivedAt: '2026-11-22' });
    expect(res.status).toBe(403);
  });

  it('13. GET other-incomes lista só o tenant', async () => {
    const res = await request(app).get(OTHER).set('Authorization', authA());
    expect(res.status).toBe(200);
    expect(res.body.data.every((r: any) => !r.description.includes('Receita B'))).toBe(true);
  });

  it('14. período filtra cartão pelo expectedDate do CardReceivable (spec:1136)', async () => {
    const acquirer = await prisma.acquirer.create({
      data: {
        companyId: fixture.companyAId,
        name: `Adq Rec ${fixture.suffix}`,
        bankKeywords: [],
      },
    });
    const payment = await prisma.payment.create({
      data: {
        companyId: fixture.companyAId,
        clientId: fixture.clientAId,
        amount: 7777,
        method: 'CREDIT',
        status: 'PAID',
        paidAt: new Date('2026-11-01T12:00:00Z'),
        acquirerId: acquirer.id,
        feeAmount: 100,
        netAmount: 7677,
      },
    });
    await prisma.cardReceivable.create({
      data: {
        companyId: fixture.companyAId,
        paymentId: payment.id,
        acquirerId: acquirer.id,
        installmentNumber: 1,
        installmentTotal: 1,
        grossAmount: 7777,
        feeAmount: 100,
        netAmount: 7677,
        expectedDate: new Date('2026-12-10T12:00:00Z'),
        isReconciled: false,
      },
    });

    const res = await request(app)
      .get(`${RECEIVABLES}?from=2026-12-01&to=2026-12-31`)
      .set('Authorization', authA());
    expect(res.status).toBe(200);
    const row = res.body.data.find((r: any) => r.amount === 7777);
    expect(row).toBeDefined();
    expect(row.expectedDate).toContain('2026-12-10');
    expect(row.feeAmount).toBe(100);
  });

  it('15. filtro acquirerId cobre Payment sem CardReceivable', async () => {
    const acquirer = await prisma.acquirer.create({
      data: {
        companyId: fixture.companyAId,
        name: `Adq SemParcela ${fixture.suffix}`,
        bankKeywords: [],
      },
    });
    await prisma.payment.create({
      data: {
        companyId: fixture.companyAId,
        clientId: fixture.clientAId,
        amount: 6666,
        method: 'CREDIT',
        status: 'PAID',
        paidAt: new Date('2026-11-18T12:00:00Z'),
        acquirerId: acquirer.id,
      },
    });
    const res = await request(app)
      .get(`${RECEIVABLES}?acquirerId=${acquirer.id}`)
      .set('Authorization', authA());
    expect(res.status).toBe(200);
    expect(res.body.data.some((r: any) => r.amount === 6666)).toBe(true);
  });

  it('16. sort=amount:desc compara números, não strings', async () => {
    await prisma.payment.create({
      data: {
        companyId: fixture.companyAId,
        clientId: fixture.clientAId,
        amount: 9,
        method: 'PIX',
        status: 'PAID',
        paidAt: new Date('2026-11-19T12:00:00Z'),
      },
    });
    const res = await request(app)
      .get(`${RECEIVABLES}?method=PIX&sort=amount:desc`)
      .set('Authorization', authA());
    expect(res.status).toBe(200);
    // 250 > 100 > 9 numericamente; '9'.localeCompare('250') === 1 poria 9 primeiro.
    expect(res.body.data[0].amount).toBe(250);
  });

  it('17. summary cobre a lista inteira mesmo com limit menor', async () => {
    const all = await request(app)
      .get(`${RECEIVABLES}?limit=100`)
      .set('Authorization', authA());
    const page = await request(app)
      .get(`${RECEIVABLES}?limit=1`)
      .set('Authorization', authA());
    const sum = all.body.data.reduce((s: number, r: any) => s + r.amount, 0);
    expect(page.body.data).toHaveLength(1);
    expect(page.body.summary.totalExpected).toBeCloseTo(sum, 2);
  });

  it('18. PUT com bankAccountId de outro tenant é 404', async () => {
    const created = await request(app)
      .post(OTHER)
      .set('Authorization', authA())
      .send({ description: `Avulsa FK banco ${fixture.suffix}`, amount: 20, receivedAt: '2026-11-22' });
    const bankB = await prisma.bankAccount.create({
      data: {
        companyId: fixture.companyBId,
        name: `Conta B ${fixture.suffix}`,
        initialBalanceDate: new Date('2026-01-01T00:00:00Z'),
      },
    });
    const res = await request(app)
      .put(`${OTHER}/${created.body.data.id}`)
      .set('Authorization', authA())
      .send({ bankAccountId: bankB.id });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('BANK_ACCOUNT_NOT_FOUND');
  });

  it('19. to=YYYY-MM-DD inclui paidAt no último dia', async () => {
    await prisma.payment.create({
      data: {
        companyId: fixture.companyAId,
        clientId: fixture.clientAId,
        amount: 5555,
        method: 'PIX',
        status: 'PAID',
        paidAt: new Date('2026-11-30T23:30:00Z'),
      },
    });
    const res = await request(app)
      .get(`${RECEIVABLES}?from=2026-11-01&to=2026-11-30`)
      .set('Authorization', authA());
    expect(res.status).toBe(200);
    expect(res.body.data.some((r: any) => r.amount === 5555)).toBe(true);
  });
});
