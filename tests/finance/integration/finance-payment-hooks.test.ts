/**
 * [F1.3] Hooks de pagamento + recebíveis de cartão + PDV→Payment.
 *
 * Roda somente contra o banco de teste. Exercita confirm/refund dentro da
 * mesma transação: CASH → CashMovement, CREDIT → CardReceivable[], estorno
 * de dinheiro → OUT, estorno de cartão conciliado → 409, POST /sales cria
 * Payment com saleId e o endpoint legado /payments/:id/confirm segue 200.
 */
import bcrypt from 'bcrypt';
import request from 'supertest';
import app from '../../../src/app';
import prisma from '../../../src/config/db';
import { seedCompanyFinance } from '../../../prisma/seed.finance';
import { seedTwoTenants, TenantFixture } from '../helpers/tenancy';

const CASH_SESSIONS = '/api/v1/finance/cash/sessions';
const RECEIVABLES = '/api/v1/finance/card-receivables';

describe('payment hooks and card receivables (finance F1.3)', () => {
  let fixture: TenantFixture;
  let registerId: string;
  let acquirerId: string;
  let tokenA: string;
  let tokenB: string;
  let userAId: string;

  const authA = () => `Bearer ${tokenA}`;

  async function makeUser(label: string, permissions: string[]) {
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
        companyId: fixture.companyAId,
      },
    });
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'teste123' });
    if (login.status !== 200) {
      throw new Error(`Login ${label} falhou (${login.status}): ${JSON.stringify(login.body)}`);
    }
    return { user, token: login.body.data.accessToken as string };
  }

  async function openSession(): Promise<string> {
    const res = await request(app)
      .post(`${CASH_SESSIONS}/open`)
      .set('Authorization', authA())
      .send({ registerId, openingBalance: 0 });
    expect(res.status).toBe(201);
    return res.body.data.id as string;
  }

  async function createPayment(method: string, amount: number, installments = 1) {
    const payment = await prisma.payment.create({
      data: {
        companyId: fixture.companyAId,
        clientId: fixture.clientAId,
        amount,
        method: method as any,
        status: 'PENDING',
        installments,
      },
    });
    return payment.id;
  }

  async function confirm(id: string, token = tokenA) {
    return request(app)
      .post(`/api/v1/payments/${id}/confirm`)
      .set('Authorization', `Bearer ${token}`);
  }

  beforeAll(async () => {
    fixture = await seedTwoTenants();
    await seedCompanyFinance(prisma, fixture.companyAId);
    await seedCompanyFinance(prisma, fixture.companyBId);

    tokenA = fixture.tokenA;
    tokenB = fixture.tokenB;
    userAId = fixture.userAId;

    const register = await prisma.cashRegister.findFirstOrThrow({
      where: { companyId: fixture.companyAId },
    });
    registerId = register.id;

    const acquirer = await prisma.acquirer.create({
      data: {
        companyId: fixture.companyAId,
        name: `Maquininha ${fixture.suffix}`,
        bankKeywords: [],
        debitRate: 2,
        creditRate: 2,
        creditInstallmentRate: 3.99,
        settlementDaysDebit: 1,
        settlementDaysCredit: 30,
        anticipates: false,
      },
    });
    acquirerId = acquirer.id;

    const bank = await prisma.bankAccount.create({
      data: {
        companyId: fixture.companyAId,
        name: `Conta ${fixture.suffix}`,
        initialBalanceDate: new Date('2026-01-01T00:00:00Z'),
      },
    });
    void bank; // criada para o hook de PIX/LINK escolher automaticamente.

    // Permissões extras da fixture (o papel padrão já tem finance.cash.operate).
    const extra = await makeUser('Financeiro', [
      'finance.cash.operate',
      'finance.receivables.list',
    ]);
    tokenA = extra.token;
    userAId = extra.user.id;

    await prisma.financeSettings.update({
      where: { companyId: fixture.companyAId },
      data: { requireOpenCashSession: true },
    });
  }, 120_000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // ------------------------------------------------------------------- CASH

  it('CASH confirmado cria CashMovement SALE/IN e vincula payment.cashSessionId', async () => {
    const sessionId = await openSession();
    const id = await createPayment('CASH', 150);

    const res = await confirm(id);
    expect(res.status).toBe(200);

    const payment = await prisma.payment.findUniqueOrThrow({ where: { id } });
    expect(payment.status).toBe('PAID');
    expect(payment.cashSessionId).toBe(sessionId);

    const movement = await prisma.cashMovement.findFirst({ where: { paymentId: id } });
    expect(movement).not.toBeNull();
    expect(movement!.type).toBe('SALE');
    expect(movement!.direction).toBe('IN');
    expect(Number(movement!.amount)).toBe(150);
    expect(movement!.createdById).toBe(userAId);
  });

  it('CASH sem sessão aberta devolve 409 CASH_SESSION_REQUIRED', async () => {
    // Fecha qualquer sessão OPEN da empresa para garantir o cenário sem caixa.
    await prisma.cashSession.updateMany({
      where: { companyId: fixture.companyAId, status: 'OPEN' },
      data: { status: 'CLOSED', closedAt: new Date() },
    });
    const id = await createPayment('CASH', 50);

    const res = await confirm(id);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CASH_SESSION_REQUIRED');

    const movement = await prisma.cashMovement.findFirst({ where: { paymentId: id } });
    expect(movement).toBeNull();
  });

  // ------------------------------------------------------------------ CARD

  it('CREDIT 3x cria 3 CardReceivable com soma correta (I7)', async () => {
    const id = await createPayment('CREDIT', 300, 3);

    const res = await confirm(id);
    expect(res.status).toBe(200);

    const rows = await prisma.cardReceivable.findMany({
      where: { paymentId: id },
      orderBy: { installmentNumber: 'asc' },
    });
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => Number(r.netAmount))).toEqual([96.01, 96.01, 96.01]);
    expect(rows.map((r) => Number(r.feeAmount))).toEqual([3.99, 3.99, 3.99]);
    expect(rows.reduce((sum, r) => sum + Number(r.netAmount), 0)).toBeCloseTo(288.03, 2);
    expect(rows.every((r) => r.acquirerId === acquirerId)).toBe(true);

    const payment = await prisma.payment.findUniqueOrThrow({ where: { id } });
    expect(payment.acquirerId).toBe(acquirerId);
    expect(Number(payment.feeAmount)).toBeCloseTo(11.97, 2);
    expect(Number(payment.netAmount)).toBeCloseTo(288.03, 2);
  });

  it('cartão sem acquirer cadastrado devolve 422 ACQUIRER_REQUIRED', async () => {
    await prisma.acquirer.updateMany({
      where: { companyId: fixture.companyAId },
      data: { isActive: false },
    });
    const id = await createPayment('DEBIT', 100);

    const res = await confirm(id);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('ACQUIRER_REQUIRED');

    await prisma.acquirer.updateMany({
      where: { companyId: fixture.companyAId },
      data: { isActive: true },
    });
  });

  it('refund de dinheiro cria CashMovement REFUND/OUT na sessão atual', async () => {
    const sessionId = await openSession();
    const id = await createPayment('CASH', 80);
    expect((await confirm(id)).status).toBe(200);

    const res = await request(app)
      .post(`/api/v1/payments/${id}/refund`)
      .set('Authorization', authA());
    expect(res.status).toBe(200);

    const refunds = await prisma.cashMovement.findMany({
      where: { paymentId: id, type: 'REFUND' },
    });
    expect(refunds).toHaveLength(1);
    expect(refunds[0].direction).toBe('OUT');
    expect(refunds[0].sessionId).toBe(sessionId);
    expect(Number(refunds[0].amount)).toBe(80);
  });

  it('refund de cartão não conciliado remove os recebíveis', async () => {
    const id = await createPayment('CREDIT', 200, 2);
    expect((await confirm(id)).status).toBe(200);
    expect(await prisma.cardReceivable.count({ where: { paymentId: id } })).toBe(2);

    const res = await request(app)
      .post(`/api/v1/payments/${id}/refund`)
      .set('Authorization', authA());
    expect(res.status).toBe(200);
    expect(await prisma.cardReceivable.count({ where: { paymentId: id } })).toBe(0);
  });

  it('refund de cartão com recebível conciliado devolve 409', async () => {
    const id = await createPayment('CREDIT', 400, 2);
    expect((await confirm(id)).status).toBe(200);
    await prisma.cardReceivable.updateMany({
      where: { paymentId: id, installmentNumber: 1 },
      data: { isReconciled: true, reconciledAt: new Date() },
    });

    const res = await request(app)
      .post(`/api/v1/payments/${id}/refund`)
      .set('Authorization', authA());
    expect(res.status).toBe(409);

    const payment = await prisma.payment.findUniqueOrThrow({ where: { id } });
    expect(payment.status).toBe('PAID'); // transação inteira reverteu
    expect(await prisma.cardReceivable.count({ where: { paymentId: id } })).toBe(2);
  });

  // --------------------------------------------------------------- read path

  it('GET /card-receivables é paginado, isolado e filtrável', async () => {
    const id = await createPayment('CREDIT', 120, 2);
    expect((await confirm(id)).status).toBe(200);

    const res = await request(app)
      .get(`${RECEIVABLES}?page=1&limit=1&isReconciled=false`)
      .set('Authorization', authA());
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.data).toHaveLength(1);
    expect(res.body.pagination).toMatchObject({ page: 1, limit: 1 });
    expect(res.body.pagination.total).toBeGreaterThanOrEqual(2);
    expect(res.body.data.every((r: any) => r.companyId === undefined || r.companyId === fixture.companyAId)).toBe(true);

    const isolated = await request(app)
      .get(RECEIVABLES)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(isolated.status).toBe(200);
    expect(isolated.body.data).toHaveLength(0);
  });

  // ------------------------------------------------------------------- PDV

  it('POST /sales cria Payment com saleId na mesma transação', async () => {
    const product = await prisma.product.create({
      data: {
        companyId: fixture.companyAId,
        sku: `SKU-HOOK-${fixture.suffix}`,
        name: `Produto Hook ${fixture.suffix}`,
        category: 'cosmetico',
        costPrice: 10,
        salePrice: 25,
        quantity: 10,
      },
    });

    const res = await request(app)
      .post('/api/v1/sales')
      .set('Authorization', authA())
      .send({
        clientId: fixture.clientAId,
        items: [{ productId: product.id, quantity: 2, unitPrice: 25 }],
        paymentMethod: 'PIX',
      });
    expect(res.status).toBe(201);

    const saleId = res.body?.data?.sale?.id ?? res.body?.data?.id;
    expect(saleId).toBeDefined();
    const payment = await prisma.payment.findFirst({ where: { saleId } });
    expect(payment).not.toBeNull();
    expect(payment!.companyId).toBe(fixture.companyAId);
    expect(Number(payment!.amount)).toBe(50);
    expect(payment!.status).toBe('PENDING');
  });

  // ------------------------------------------------------------- legado/tenant

  it('POST /payments/:id/confirm legado responde 200 sem userId explícito', async () => {
    const id = await createPayment('PIX', 45);
    const res = await request(app)
      .post(`/api/v1/payments/${id}/confirm`)
      .set('Authorization', `Bearer ${fixture.tokenA}`); // token do usuário "A" original
    expect(res.status).toBe(200);
    expect(res.body.data.payment.status).toBe('PAID');
  });

  it('confirm de pagamento de outro tenant devolve 404', async () => {
    const res = await confirm(fixture.paymentBId);
    expect(res.status).toBe(404);
  });
});
