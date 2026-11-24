/**
 * [F1.4] Fachada A pagar sobre Expense — spec:1102-1129 (P1–P8).
 * Roda somente contra o banco de teste. Cobertura: pagar em dinheiro com/sem
 * caixa, pagar em conta sem banco, parcelamento, recorrência idempotente,
 * P6/P7 e isolamento. `/expenses` legado precisa continuar idêntico.
 */
import request from 'supertest';
import app from '../../../src/app';
import prisma from '../../../src/config/db';
import { payablesService } from '../../../src/api/v1/finance/payables/payables.service';
import { seedCompanyFinance } from '../../../prisma/seed.finance';
import { seedTwoTenants, TenantFixture } from '../helpers/tenancy';

const BASE = '/api/v1/finance/payables';

describe('payables facade (finance F1.4)', () => {
  let fixture: TenantFixture;
  let registerId: string;
  let bankAccountId: string;
  let foreignBankAccountId: string;
  let categoryAId: string;
  let foreignCategoryId: string;
  let supplierAId: string;
  let foreignSupplierId: string;

  const authA = () => `Bearer ${fixture.tokenA}`;
  const authB = () => `Bearer ${fixture.tokenB}`;

  async function closeAllSessions() {
    await prisma.cashSession.updateMany({
      where: { companyId: fixture.companyAId, status: 'OPEN' },
      data: { status: 'CLOSED', closedAt: new Date() },
    });
  }

  async function openSession(): Promise<string> {
    const res = await request(app)
      .post('/api/v1/finance/cash/sessions/open')
      .set('Authorization', authA())
      .send({ registerId, openingBalance: 0 });
    expect(res.status).toBe(201);
    return res.body.data.id as string;
  }

  function payable(over: Record<string, unknown> = {}) {
    return {
      description: `Conta ${fixture.suffix}`,
      category: 'FORNECEDORES',
      amount: 100,
      dueDate: '2026-12-15T12:00:00.000Z',
      ...over,
    };
  }

  async function create(over: Record<string, unknown> = {}) {
    const res = await request(app).post(BASE).set('Authorization', authA()).send(payable(over));
    expect(res.status).toBe(201);
    return res.body.data;
  }

  const pay = (id: string, body: Record<string, unknown>) =>
    request(app).post(`${BASE}/${id}/pay`).set('Authorization', authA()).send(body);

  beforeAll(async () => {
    fixture = await seedTwoTenants();
    await seedCompanyFinance(prisma, fixture.companyAId);
    await seedCompanyFinance(prisma, fixture.companyBId);

    const register = await prisma.cashRegister.findFirstOrThrow({
      where: { companyId: fixture.companyAId },
    });
    registerId = register.id;

    const bank = await prisma.bankAccount.create({
      data: {
        companyId: fixture.companyAId,
        name: `Conta ${fixture.suffix}`,
        initialBalance: 0,
        initialBalanceDate: new Date('2026-01-01T00:00:00Z'),
      },
    });
    bankAccountId = bank.id;

    const foreign = await prisma.bankAccount.create({
      data: {
        companyId: fixture.companyBId,
        name: `Conta B ${fixture.suffix}`,
        initialBalance: 0,
        initialBalanceDate: new Date('2026-01-01T00:00:00Z'),
      },
    });
    foreignBankAccountId = foreign.id;

    const catA = await prisma.financialCategory.findFirstOrThrow({
      where: { companyId: fixture.companyAId },
    });
    categoryAId = catA.id;
    const catB = await prisma.financialCategory.findFirstOrThrow({
      where: { companyId: fixture.companyBId },
    });
    foreignCategoryId = catB.id;

    const supA = await prisma.supplier.create({
      data: { companyId: fixture.companyAId, name: `Forn A ${fixture.suffix}` },
    });
    supplierAId = supA.id;
    const supB = await prisma.supplier.create({
      data: { companyId: fixture.companyBId, name: `Forn B ${fixture.suffix}` },
    });
    foreignSupplierId = supB.id;
  }, 120_000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // ------------------------------------------------------------------ criação

  it('1. parcelamento cria N despesas com grupo compartilhado e soma exata', async () => {
    const rows = await create({ amount: 100, installments: 3 });
    expect(Array.isArray(rows)).toBe(true);
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((r: any) => r.installmentGroupId)).size).toBe(1);
    expect(rows.map((r: any) => r.installmentNumber)).toEqual([1, 2, 3]);
    expect(rows.map((r: any) => r.installmentTotal)).toEqual([3, 3, 3]);
    expect(rows.reduce((sum: number, r: any) => sum + Number(r.amount), 0)).toBeCloseTo(100, 2);
    expect(rows.map((r: any) => r.dueDate.slice(0, 10))).toEqual([
      '2026-12-15',
      '2027-01-15',
      '2027-02-15',
    ]);

    const persisted = await prisma.expense.count({
      where: { companyId: fixture.companyAId, installmentGroupId: rows[0].installmentGroupId },
    });
    expect(persisted).toBe(3);
  });

  it('2. recorrência é o modelo; gerador 2× não duplica ocorrências', async () => {
    const [parent] = await create({ recurrenceInterval: 'MONTHLY' });
    expect(parent.recurrenceInterval).toBe('MONTHLY');
    expect(parent.recurrenceParentId).toBeNull();

    const today = new Date('2026-11-23T12:00:00.000Z');
    const first = await payablesService.generateOccurrences(
      fixture.companyAId,
      parent.id,
      today
    );
    const second = await payablesService.generateOccurrences(
      fixture.companyAId,
      parent.id,
      today
    );

    expect(first).toBeGreaterThan(0);
    expect(second).toBe(0);
    const children = await prisma.expense.findMany({
      where: { companyId: fixture.companyAId, recurrenceParentId: parent.id },
      orderBy: { dueDate: 'asc' },
    });
    expect(children).toHaveLength(first);
    expect(children.every((c) => c.source === 'RECURRING')).toBe(true);
  });

  it('3. parcelamento e recorrência juntos são rejeitados (422)', async () => {
    const res = await request(app)
      .post(BASE)
      .set('Authorization', authA())
      .send(payable({ installments: 2, recurrenceInterval: 'MONTHLY' }));
    expect(res.status).toBe(422);
  });

  // ----------------------------------------------------------- pagar (P1-P3,P8)

  it('4. P2 — pagar CASH sem caixa aberto devolve 409 CASH_SESSION_REQUIRED', async () => {
    await closeAllSessions();
    const [item] = await create();
    const res = await pay(item.id, {
      paidAt: '2026-11-23T12:00:00.000Z',
      paymentMethod: 'CASH',
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CASH_SESSION_REQUIRED');
  });

  it('5. P2/P8 — pagar CASH com caixa cria CashMovement EXPENSE/OUT na mesma tx', async () => {
    const sessionId = await openSession();
    const [item] = await create({ amount: 75.5 });
    const res = await pay(item.id, {
      paidAt: '2026-11-23T12:00:00.000Z',
      paidAmount: 80,
      paymentMethod: 'CASH',
      bankAccountId: bankAccountId,
    });
    expect(res.status).toBe(200);
    expect(res.body.data.isPaid).toBe(true);
    expect(Number(res.body.data.paidAmount)).toBe(80);
    expect(res.body.data.paymentMethod).toBe('CASH');
    expect(res.body.data.bankAccountId).toBeNull();

    const movement = await prisma.cashMovement.findFirstOrThrow({
      where: { companyId: fixture.companyAId, expenseId: item.id },
    });
    expect(movement.sessionId).toBe(sessionId);
    expect(movement.type).toBe('EXPENSE');
    expect(movement.direction).toBe('OUT');
    expect(Number(movement.amount)).toBe(80);
  });

  it('6. P2 — pagar CASH é idempotente (segunda chamada não duplica movimento)', async () => {
    await closeAllSessions();
    await openSession();
    const [item] = await create();
    const body = { paidAt: '2026-11-23T12:00:00.000Z', paymentMethod: 'CASH' };
    expect((await pay(item.id, body)).status).toBe(200);
    expect((await pay(item.id, body)).status).toBe(200);
    expect(await prisma.cashMovement.count({ where: { expenseId: item.id } })).toBe(1);
  });

  it('7. P3 — pagar PIX sem bankAccountId devolve 422', async () => {
    const [item] = await create();
    const res = await pay(item.id, {
      paidAt: '2026-11-23T12:00:00.000Z',
      paymentMethod: 'PIX',
    });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('BANK_ACCOUNT_REQUIRED');
  });

  it('8. P3/P8 — pagar PIX com conta do tenant grava vínculos e sem movimento de caixa', async () => {
    const [item] = await create({ amount: 45 });
    const res = await pay(item.id, {
      paidAt: '2026-11-23T12:00:00.000Z',
      paymentMethod: 'PIX',
      bankAccountId,
    });
    expect(res.status).toBe(200);
    expect(res.body.data.bankAccountId).toBe(bankAccountId);
    expect(Number(res.body.data.paidAmount)).toBe(45);
    expect(await prisma.cashMovement.count({ where: { expenseId: item.id } })).toBe(0);
  });

  it('9. bankAccountId de outro tenant devolve 404', async () => {
    const [item] = await create();
    const res = await pay(item.id, {
      paidAt: '2026-11-23T12:00:00.000Z',
      paymentMethod: 'PIX',
      bankAccountId: foreignBankAccountId,
    });
    expect(res.status).toBe(404);
  });

  // --------------------------------------------------------------- P6 / P7 / delete

  it('10. P6 — despesa paga e conciliada não altera amount/paidAt (409)', async () => {
    const [item] = await create();
    await prisma.expense.update({
      where: { id: item.id },
      data: { isPaid: true, paidDate: new Date('2026-11-23T12:00:00Z'), isReconciled: true },
    });
    const res = await request(app)
      .put(`${BASE}/${item.id}`)
      .set('Authorization', authA())
      .send({ amount: 200 });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('EXPENSE_RECONCILED');
  });

  it('11. P7 — cancelar pago ou conciliado → 409; não pago → 200 CANCELED', async () => {
    const [paid] = await create();
    await prisma.expense.update({
      where: { id: paid.id },
      data: { isPaid: true, paidDate: new Date('2026-11-23T12:00:00Z') },
    });
    const paidRes = await request(app)
      .post(`${BASE}/${paid.id}/cancel`)
      .set('Authorization', authA());
    expect(paidRes.status).toBe(409);

    const [linked] = await create();
    await prisma.expense.update({
      where: { id: linked.id },
      data: { isReconciled: true, reconciledAt: new Date('2026-11-23T12:00:00Z') },
    });
    const linkedRes = await request(app)
      .post(`${BASE}/${linked.id}/cancel`)
      .set('Authorization', authA());
    expect(linkedRes.status).toBe(409);

    const [free] = await create();
    const ok = await request(app)
      .post(`${BASE}/${free.id}/cancel`)
      .set('Authorization', authA());
    expect(ok.status).toBe(200);
    expect(ok.body.data.canceledAt).toBeTruthy();
    expect(ok.body.data.status).toBe('CANCELED');
  });

  it('12. DELETE remove só despesa não paga e não conciliada', async () => {
    const [paid] = await create();
    await prisma.expense.update({ where: { id: paid.id }, data: { isPaid: true } });
    expect(
      (await request(app).delete(`${BASE}/${paid.id}`).set('Authorization', authA())).status
    ).toBe(409);

    const [free] = await create();
    expect(
      (await request(app).delete(`${BASE}/${free.id}`).set('Authorization', authA())).status
    ).toBe(200);
  });

  // -------------------------------------------------------------- listagem / RBAC

  it('13. GET /payables devolve status derivado e filtra por status', async () => {
    await create({ description: `Vencida ${fixture.suffix}`, dueDate: '2020-01-01T12:00:00Z' });
    const res = await request(app)
      .get(`${BASE}?status=OVERDUE&limit=100`)
      .set('Authorization', authA());
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.pagination).toBeDefined();
    expect(res.body.data.every((e: any) => e.status === 'OVERDUE')).toBe(true);
    expect(res.body.data.some((e: any) => e.description === `Vencida ${fixture.suffix}`)).toBe(true);
  });

  it('14. isolamento: payables de outro tenant são 404 em todas as operações', async () => {
    const foreign = await prisma.expense.create({
      data: {
        companyId: fixture.companyBId,
        description: `B ${fixture.suffix}`,
        category: 'OUTROS',
        amount: 10,
        dueDate: new Date('2026-12-15T12:00:00Z'),
      },
    });
    expect(
      (await request(app).get(`${BASE}/${foreign.id}`).set('Authorization', authA())).status
    ).toBe(404);
    expect(
      (await request(app).get(`${BASE}/${foreign.id}`).set('Authorization', authB())).status
    ).toBe(200);
    expect(
      (await pay(foreign.id, { paidAt: '2026-11-23T12:00:00Z', paymentMethod: 'PIX', bankAccountId }))
        .status
    ).toBe(404);
    expect(
      (
        await request(app)
          .post(`${BASE}/${foreign.id}/cancel`)
          .set('Authorization', authA())
      ).status
    ).toBe(404);
    expect(
      (await request(app).delete(`${BASE}/${foreign.id}`).set('Authorization', authA())).status
    ).toBe(404);
  });

  it('15. RBAC: escrita sem finance.payables.* devolve 403', async () => {
    const role = await prisma.role.create({
      data: { name: `NoPay-${fixture.suffix}`, isSystem: false, isActive: true },
    });
    const user = await prisma.user.create({
      data: {
        email: `nopay-${fixture.suffix}@test.local`,
        passwordHash: await import('bcrypt').then((b) => b.default.hash('teste123', 4)),
        name: 'Sem permissão payables',
        roleId: role.id,
        companyId: fixture.companyAId,
      },
    });
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'teste123' });
    expect(login.status).toBe(200);
    const token = login.body.data.accessToken;

    expect((await request(app).post(BASE).set('Authorization', `Bearer ${token}`).send(payable())).status).toBe(403);
    expect((await request(app).get(BASE).set('Authorization', `Bearer ${token}`)).status).toBe(403);
  });

  it('16. /expenses legado continua igual (envelope e baixa simples)', async () => {
    const created = await request(app)
      .post('/api/v1/expenses')
      .set('Authorization', authA())
      .send(payable());
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('success');
    expect(created.body.data.expense).toBeDefined();

    const list = await request(app).get('/api/v1/expenses').set('Authorization', authA());
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body.data)).toBe(true);

    const paid = await request(app)
      .post(`/api/v1/expenses/${created.body.data.expense.id}/pay`)
      .set('Authorization', authA());
    expect(paid.status).toBe(200);
    expect(paid.body.data.expense.isPaid).toBe(true);
  });

  // ----------------------------------- correções do review (não-bloqueantes)

  it('17. paidAt exposto no JSON de resposta (espelha paidDate)', async () => {
    const [item] = await create();
    expect(item.paidAt).toBeNull();

    const res = await pay(item.id, {
      paidAt: '2026-11-23T12:00:00.000Z',
      paymentMethod: 'PIX',
      bankAccountId,
    });
    expect(res.status).toBe(200);
    expect(res.body.data.paidAt).toBe('2026-11-23T12:00:00.000Z');
    expect(res.body.data.paidDate).toBe('2026-11-23T12:00:00.000Z');

    const byId = await request(app)
      .get(`${BASE}/${item.id}`)
      .set('Authorization', authA());
    expect(byId.status).toBe(200);
    expect(byId.body.data.paidAt).toBe('2026-11-23T12:00:00.000Z');

    const listed = await request(app)
      .get(`${BASE}?limit=100`)
      .set('Authorization', authA());
    expect(listed.status).toBe(200);
    expect(listed.body.data.find((e: any) => e.id === item.id).paidAt).toBe(
      '2026-11-23T12:00:00.000Z'
    );
  });

  it('18. paidAmount passa pela fronteira HALF_UP e rejeita valor que arredonda a zero', async () => {
    await closeAllSessions();
    await openSession();
    const [item] = await create({ amount: 100 });
    const res = await pay(item.id, {
      paidAt: '2026-11-23T12:00:00.000Z',
      paidAmount: 100.005,
      paymentMethod: 'CASH',
    });
    expect(res.status).toBe(200);
    expect(Number(res.body.data.paidAmount)).toBe(100.01);
    const movement = await prisma.cashMovement.findFirstOrThrow({
      where: { expenseId: item.id },
    });
    expect(Number(movement.amount)).toBe(100.01);

    const [tiny] = await create({ amount: 100 });
    const bad = await pay(tiny.id, {
      paidAt: '2026-11-23T12:00:00.000Z',
      paidAmount: 0.001,
      paymentMethod: 'CASH',
    });
    expect(bad.status).toBe(422);
    expect(bad.body.code).toBe('INVALID_PAID_AMOUNT');
    // rollback: nada foi gravado — nem expense paga, nem movimento de caixa.
    const after = await prisma.expense.findUniqueOrThrow({ where: { id: tiny.id } });
    expect(after.isPaid).toBe(false);
    expect(after.paidAmount).toBeNull();
    expect(await prisma.cashMovement.count({ where: { expenseId: tiny.id } })).toBe(0);
  });

  it('19. categoryId/supplierId de outro tenant são 404; os do tenant gravam', async () => {
    const badCat = await request(app)
      .post(BASE)
      .set('Authorization', authA())
      .send(payable({ categoryId: foreignCategoryId }));
    expect(badCat.status).toBe(404);
    expect(badCat.body.code).toBe('CATEGORY_NOT_FOUND');

    const badSup = await request(app)
      .post(BASE)
      .set('Authorization', authA())
      .send(payable({ supplierId: foreignSupplierId }));
    expect(badSup.status).toBe(404);
    expect(badSup.body.code).toBe('SUPPLIER_NOT_FOUND');

    const [good] = await create({ categoryId: categoryAId, supplierId: supplierAId });
    expect(good.categoryId).toBe(categoryAId);
    expect(good.supplierId).toBe(supplierAId);

    const [changed] = await create();
    const upd = await request(app)
      .put(`${BASE}/${changed.id}`)
      .set('Authorization', authA())
      .send({ supplierId: foreignSupplierId });
    expect(upd.status).toBe(404);
    expect(upd.body.code).toBe('SUPPLIER_NOT_FOUND');

    const badCatUpd = await request(app)
      .put(`${BASE}/${changed.id}`)
      .set('Authorization', authA())
      .send({ categoryId: foreignCategoryId });
    expect(badCatUpd.status).toBe(404);
    expect(badCatUpd.body.code).toBe('CATEGORY_NOT_FOUND');
  });

  it('20. gerador não cria ocorrências de modelo cancelado', async () => {
    const [parent] = await create({ recurrenceInterval: 'MONTHLY' });
    await prisma.expense.update({
      where: { id: parent.id },
      data: { canceledAt: new Date('2026-11-23T12:00:00Z') },
    });
    const createdCount = await payablesService.generateOccurrences(
      fixture.companyAId,
      parent.id,
      new Date('2026-11-23T12:00:00Z')
    );
    expect(createdCount).toBe(0);
    expect(
      await prisma.expense.count({ where: { recurrenceParentId: parent.id } })
    ).toBe(0);
  });
});
