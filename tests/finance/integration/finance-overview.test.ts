/**
 * [F1.6] GET /finance/overview — spec:1142-1153.
 * Cobertura: 6 blocos, isolamento por empresa, RBAC (`finance.reports`),
 * saldo I10 (F1) e validação de período.
 */
import bcrypt from 'bcrypt';
import request from 'supertest';
import app from '../../../src/app';
import prisma from '../../../src/config/db';
import { seedTwoTenants, TenantFixture } from '../helpers/tenancy';

const OVERVIEW = '/api/v1/finance/overview';

describe('finance overview (finance F1.6)', () => {
  let fixture: TenantFixture;
  let tokenNoPerm: string;
  const now = new Date();
  const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);
  const today = () => `${now.toISOString().slice(0, 10)}T12:00:00Z`;
  const monthStart = () => `${now.toISOString().slice(0, 7)}-01`;
  const period = () => `?from=${monthStart()}&to=${now.toISOString().slice(0, 10)}`;

  beforeAll(async () => {
    fixture = await seedTwoTenants();
    await prisma.payment.deleteMany({
      where: { id: { in: [fixture.paymentAId, fixture.paymentBId] } },
    });

    const permission = await prisma.permission.upsert({
      where: { name: 'clients.read' },
      update: {},
      create: { name: 'clients.read', description: 'clients.read', module: 'clients' },
    });
    const role = await prisma.role.create({
      data: {
        name: `SemRelatorio-${fixture.suffix}`,
        isSystem: false,
        isActive: true,
        rolePermissions: { create: [{ permissionId: permission.id }] },
      },
    });
    const user = await prisma.user.create({
      data: {
        email: `sem-relatorio-${fixture.suffix}@test.local`,
        passwordHash: await bcrypt.hash('teste123', 4),
        name: 'Sem Relatório',
        roleId: role.id,
        companyId: fixture.companyAId,
      },
    });
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'teste123' });
    tokenNoPerm = login.body.data.accessToken;

    const bank = await prisma.bankAccount.create({
      data: {
        companyId: fixture.companyAId,
        name: `Conta Overview ${fixture.suffix}`,
        initialBalance: 1000,
        initialBalanceDate: new Date(today()),
      },
    });

    await prisma.payment.create({
      data: {
        companyId: fixture.companyAId,
        clientId: fixture.clientAId,
        bankAccountId: bank.id,
        amount: 100,
        method: 'PIX',
        status: 'PAID',
        paidAt: daysAgo(0.04),
      },
    });
    await prisma.otherIncome.create({
      data: {
        companyId: fixture.companyAId,
        description: `Aluguel Overview ${fixture.suffix}`,
        amount: 50,
        receivedAt: new Date(today()),
      },
    });
    // Paga: entra em saídas. Vencida e paga: não entra em alertas de vencidas.
    await prisma.expense.create({
      data: {
        companyId: fixture.companyAId,
        description: `Conta paga ${fixture.suffix}`,
        category: 'outros',
        amount: 30,
        dueDate: daysAgo(2),
        paidDate: daysAgo(0.04),
        isPaid: true,
      },
    });
    await prisma.expense.create({
      data: {
        companyId: fixture.companyAId,
        description: `Conta vencida ${fixture.suffix}`,
        category: 'outros',
        amount: 20,
        dueDate: daysAgo(3),
      },
    });
    await prisma.payment.create({
      data: {
        companyId: fixture.companyAId,
        clientId: fixture.clientAId,
        amount: 60,
        method: 'PIX',
        status: 'PENDING',
      },
    });

    const acquirer = await prisma.acquirer.create({
      data: {
        companyId: fixture.companyAId,
        name: `Adq Overview ${fixture.suffix}`,
        bankKeywords: [],
      },
    });
    const cardPayment = await prisma.payment.create({
      data: {
        companyId: fixture.companyAId,
        clientId: fixture.clientAId,
        amount: 200,
        method: 'CREDIT',
        status: 'PAID',
        paidAt: daysAgo(0.04),
        acquirerId: acquirer.id,
      },
    });
    await prisma.cardReceivable.create({
      data: {
        companyId: fixture.companyAId,
        paymentId: cardPayment.id,
        acquirerId: acquirer.id,
        installmentNumber: 1,
        installmentTotal: 1,
        grossAmount: 200,
        feeAmount: 0,
        netAmount: 200,
        expectedDate: daysAgo(2),
        isReconciled: false,
      },
    });

    const register = await prisma.cashRegister.create({
      data: { companyId: fixture.companyAId, name: `Caixa Overview ${fixture.suffix}` },
    });
    await prisma.cashSession.create({
      data: {
        companyId: fixture.companyAId,
        registerId: register.id,
        openedById: fixture.userAId,
        openedAt: daysAgo(0.08), // ~2h — não dispara alerta de 24h
        openingBalance: 0,
      },
    });

    // Tenant B: valores que NÃO podem vazar para o overview de A.
    await prisma.payment.create({
      data: {
        companyId: fixture.companyBId,
        clientId: fixture.clientBId,
        amount: 9999,
        method: 'PIX',
        status: 'PAID',
        paidAt: daysAgo(0.04),
      },
    });
    await prisma.expense.create({
      data: {
        companyId: fixture.companyBId,
        description: `Despesa B ${fixture.suffix}`,
        category: 'outros',
        amount: 8888,
        dueDate: daysAgo(3),
      },
    });
  });

  it('1. devolve os seis blocos com saldo I10 e fluxos do tenant', async () => {
    const res = await request(app)
      .get(`${OVERVIEW}${period()}`)
      .set('Authorization', `Bearer ${fixture.tokenA}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    const d = res.body.data;
    expect(Object.keys(d).sort()).toEqual(
      ['alerts', 'bankBalances', 'cash', 'flows', 'payables', 'receivables'].sort()
    );
    expect(d.bankBalances.total).toBe(1000);
    expect(d.bankBalances.accounts[0].source).toBe('F1_INITIAL_BALANCE_ONLY');
    expect(d.flows.inflows).toBe(350);
    expect(d.flows.outflows).toBe(30);
    expect(d.flows.net).toBe(320);
  });

  it('2. a pagar e a receber com visões inclusivas e sem dupla contagem', async () => {
    const res = await request(app)
      .get(`${OVERVIEW}${period()}`)
      .set('Authorization', `Bearer ${fixture.tokenA}`);
    const d = res.body.data;
    expect(d.payables.overdue).toBe(20);
    expect(d.payables.thisMonth).toBeGreaterThanOrEqual(20);
    expect(d.receivables.cardOverdue).toBe(200);
    expect(d.receivables.pendingPayments).toBe(60);
  });

  it('3. caixa aberto e alertas', async () => {
    const res = await request(app)
      .get(`${OVERVIEW}${period()}`)
      .set('Authorization', `Bearer ${fixture.tokenA}`);
    const d = res.body.data;
    expect(d.cash.status).toBe('OPEN');
    expect(d.alerts.overdueExpenses).toBe(1);
    expect(d.alerts.cashOpenOver24h).toBe(0);
    expect(d.alerts.overdueCardReceivables).toBe(1);
  });

  it('4. isolamento: dados do tenant B não aparecem em A', async () => {
    const a = await request(app)
      .get(`${OVERVIEW}${period()}`)
      .set('Authorization', `Bearer ${fixture.tokenA}`);
    expect(a.body.data.flows.inflows).not.toBe(9999 + 350);
    expect(a.body.data.payables.overdue).toBe(20);
    const b = await request(app)
      .get(`${OVERVIEW}${period()}`)
      .set('Authorization', `Bearer ${fixture.tokenB}`);
    expect(b.status).toBe(200);
    expect(b.body.data.bankBalances.total).toBe(0);
    expect(b.body.data.flows.inflows).toBe(9999);
    expect(b.body.data.payables.overdue).toBe(8888);
  });

  it('5. RBAC: sem finance.reports → 403', async () => {
    const res = await request(app)
      .get(`${OVERVIEW}${period()}`)
      .set('Authorization', `Bearer ${tokenNoPerm}`);
    expect(res.status).toBe(403);
  });

  it('6. período inválido → 400', async () => {
    const res = await request(app)
      .get(`${OVERVIEW}?from=nao-e-data&to=2026-11-30`)
      .set('Authorization', `Bearer ${fixture.tokenA}`);
    expect(res.status).toBe(400);
  });

  it('7. data de calendário inválida não faz rollover → 400', async () => {
    const res = await request(app)
      .get(`${OVERVIEW}?from=2026-02-30&to=2026-11-30`)
      .set('Authorization', `Bearer ${fixture.tokenA}`);
    expect(res.status).toBe(400);
  });

  it('8. bankBalances expõe money como number, não Decimal/string', async () => {
    const res = await request(app)
      .get(`${OVERVIEW}${period()}`)
      .set('Authorization', `Bearer ${fixture.tokenA}`);
    expect(res.status).toBe(200);
    const acc = res.body.data.bankBalances.accounts[0];
    expect(typeof acc.balance).toBe('number');
    expect(typeof acc.initialBalance).toBe('number');
  });
});
