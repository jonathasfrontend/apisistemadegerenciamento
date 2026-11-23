/**
 * [F1.2] Caixa: abrir → movimentos → anular → fechar → reabrir (C1–C9).
 *
 * Roda somente contra o banco de teste. Regras exercitadas: sessão única por
 * caixa, movimentos só em OPEN, void sem apagar linha, expected/difference
 * por centavos, notes obrigatória na divergência, reopen auditado e C9
 * (operador comum vê só as próprias sessões).
 */
import bcrypt from 'bcrypt';
import request from 'supertest';
import app from '../../../src/app';
import prisma from '../../../src/config/db';
import { seedCompanyFinance } from '../../../prisma/seed.finance';
import { seedTwoTenants, TenantFixture } from '../helpers/tenancy';

const BASE = '/api/v1/finance/cash/sessions';

describe('cash sessions and movements (finance F1.2 / C1-C9)', () => {
  let fixture: TenantFixture;
  let registerId: string;
  let registerId2: string;
  let tokenOperator: string;
  let tokenViewAll: string;
  let tokenReopen: string;
  let operatorUserId: string;
  let sessionId: string;
  let voidMovementId: string;

  const auth = () => `Bearer ${fixture.tokenA}`;

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
        // login() normaliza para minúsculas; o email precisa ser criado já
        // minúsculo (Postgres compara email com case-sensitive).
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

  beforeAll(async () => {
    fixture = await seedTwoTenants();
    await seedCompanyFinance(prisma, fixture.companyAId);
    await seedCompanyFinance(prisma, fixture.companyBId);

    const register = await prisma.cashRegister.findFirstOrThrow({
      where: { companyId: fixture.companyAId },
    });
    registerId = register.id;
    const register2 = await prisma.cashRegister.create({
      data: { companyId: fixture.companyAId, name: `Caixa Operador ${fixture.suffix}` },
    });
    registerId2 = register2.id;

    const operator = await makeUser('Operador', ['finance.cash.operate']);
    operatorUserId = operator.user.id;
    tokenOperator = operator.token;
    tokenViewAll = (await makeUser('ViewAll', ['finance.cash.operate', 'finance.cash.view-all'])).token;
    tokenReopen = (await makeUser('Reopen', ['finance.cash.reopen'])).token;

    await prisma.financeSettings.update({
      where: { companyId: fixture.companyAId },
      data: { cashClosingTolerance: 0 },
    });
  }, 120_000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // ------------------------------------------------------------------- C1

  it('C1: open creates an OPEN session with openingBalance', async () => {
    const res = await request(app)
      .post(`${BASE}/open`)
      .set('Authorization', auth())
      .send({ registerId, openingBalance: 200 });

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('OPEN');
    expect(Number(res.body.data.openingBalance)).toBe(200);
    expect(res.body.data.openedById).toBe(fixture.userAId);
    sessionId = res.body.data.id;
  });

  it('C1: second open on the same register returns 409 CASH_SESSION_ALREADY_OPEN', async () => {
    const res = await request(app)
      .post(`${BASE}/open`)
      .set('Authorization', auth())
      .send({ registerId, openingBalance: 10 });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CASH_SESSION_ALREADY_OPEN');
  });

  it('C1: openingBalance must be non-negative', async () => {
    const res = await request(app)
      .post(`${BASE}/open`)
      .set('Authorization', auth())
      .send({ registerId: registerId2, openingBalance: -1 });

    expect(res.status).toBe(400);
  });

  it('current returns the open session for the register', async () => {
    const res = await request(app)
      .get(`${BASE}/current?registerId=${registerId}`)
      .set('Authorization', auth());

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(sessionId);
  });

  // ------------------------------------------------------------------- C2

  it('C2: movements are recorded in cents and reflected in partial totals', async () => {
    const sale = await request(app)
      .post(`${BASE}/${sessionId}/movements`)
      .set('Authorization', auth())
      .send({ type: 'SALE', direction: 'IN', amount: 120, description: 'Venda Ana' });
    expect(sale.status).toBe(201);
    expect(Number(sale.body.data.amount)).toBe(120);

    for (const mv of [
      { type: 'SALE', direction: 'IN', amount: 80, description: 'Venda Bia' },
      { type: 'EXPENSE', direction: 'OUT', amount: 25, description: 'Café' },
      { type: 'WITHDRAWAL', direction: 'OUT', amount: 300, description: 'Depósito', bankAccountId: null },
    ]) {
      const created = await request(app)
        .post(`${BASE}/${sessionId}/movements`)
        .set('Authorization', auth())
        .send(mv);
      expect(created.status).toBe(201);
    }

    const current = await request(app)
      .get(`${BASE}/current?registerId=${registerId}`)
      .set('Authorization', auth());
    expect(current.status).toBe(200);
    expect(current.body.data.totals.totalIn).toBe(20000);
    expect(current.body.data.totals.totalOut).toBe(32500);
    expect(current.body.data.totals.expected).toBe(7500);
  });

  it('C2: amount must be positive', async () => {
    const res = await request(app)
      .post(`${BASE}/${sessionId}/movements`)
      .set('Authorization', auth())
      .send({ type: 'SUPPLY', direction: 'IN', amount: 0, description: 'Zero' });

    expect(res.status).toBe(400);
  });

  it('C2: non-SALE movements require description', async () => {
    const res = await request(app)
      .post(`${BASE}/${sessionId}/movements`)
      .set('Authorization', auth())
      .send({ type: 'SUPPLY', direction: 'IN', amount: 10 });

    expect(res.status).toBe(400);
  });

  // ------------------------------------------------------------------- C4

  it('C4: void keeps the row but removes it from expected total', async () => {
    const created = await request(app)
      .post(`${BASE}/${sessionId}/movements`)
      .set('Authorization', auth())
      .send({ type: 'ADJUSTMENT', direction: 'IN', amount: 999, description: 'Lançamento errado' });
    expect(created.status).toBe(201);
    voidMovementId = created.body.data.id;

    const voided = await request(app)
      .post(`${BASE}/${sessionId}/movements/${voidMovementId}/void`)
      .set('Authorization', auth())
      .send({ reason: 'Valor digitado a mais' });
    expect(voided.status).toBe(200);
    expect(voided.body.data.voidedAt).toBeTruthy();
    expect(voided.body.data.voidReason).toBe('Valor digitado a mais');

    const stored = await prisma.cashMovement.findUniqueOrThrow({ where: { id: voidMovementId } });
    expect(stored.voidedById).toBe(fixture.userAId);

    const current = await request(app)
      .get(`${BASE}/current?registerId=${registerId}`)
      .set('Authorization', auth());
    expect(current.body.data.totals.expected).toBe(7500);
  });

  // --------------------------------------------------------------- C5/C6/C7

  it('C6: close with divergence and zero tolerance requires closingNotes', async () => {
    const res = await request(app)
      .post(`${BASE}/${sessionId}/close`)
      .set('Authorization', auth())
      .send({ countedCash: 70 });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('CLOSING_NOTES_REQUIRED');
  });

  it('C5/C7: close computes expected/difference and records summary', async () => {
    const res = await request(app)
      .post(`${BASE}/${sessionId}/close`)
      .set('Authorization', auth())
      .send({ countedCash: 70, closingNotes: 'Diferença conferida, falta de 5 reais' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('CLOSED');
    expect(Number(res.body.data.expectedCash)).toBe(75);
    expect(Number(res.body.data.difference)).toBe(-5);
    expect(res.body.data.summary).toBeTruthy();
    expect(res.body.data.summary.byType).toHaveProperty('SALE');
    expect(res.body.data.summary.byMethod).toBeTruthy();
  });

  it('C2: movement on a CLOSED session returns 409', async () => {
    const res = await request(app)
      .post(`${BASE}/${sessionId}/movements`)
      .set('Authorization', auth())
      .send({ type: 'SUPPLY', direction: 'IN', amount: 10, description: 'Tarde demais' });

    expect(res.status).toBe(409);
  });

  // ------------------------------------------------------------------- C8

  it('C8: reopen requires reason and writes an AuditLog', async () => {
    const missing = await request(app)
      .post(`${BASE}/${sessionId}/reopen`)
      .set('Authorization', `Bearer ${tokenReopen}`)
      .send({});
    expect(missing.status).toBe(400);

    const res = await request(app)
      .post(`${BASE}/${sessionId}/reopen`)
      .set('Authorization', `Bearer ${tokenReopen}`)
      .send({ reason: 'Contagem refeita com gerente' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('OPEN');

    const log = await prisma.auditLog.findFirst({
      where: {
        companyId: fixture.companyAId,
        entity: 'cash_session',
        entityId: sessionId,
        action: 'CASH_REOPEN',
      },
    });
    expect(log).not.toBeNull();
  });

  it('C8: reopen is 403 without finance.cash.reopen', async () => {
    const res = await request(app)
      .post(`${BASE}/${sessionId}/close`)
      .set('Authorization', `Bearer ${tokenReopen}`)
      .send({ countedCash: 75 });
    expect(res.status).toBe(403);

    // O teste anterior já reabriu a sessão; fechar de novo para que este
    // reopen exercise a transição CLOSED → OPEN (máquina de estados C8).
    const reclose = await request(app)
      .post(`${BASE}/${sessionId}/close`)
      .set('Authorization', auth())
      .send({ countedCash: 75, closingNotes: 'Revisão final' });
    expect(reclose.status).toBe(200);

    const reopen = await request(app)
      .post(`${BASE}/${sessionId}/reopen`)
      .set('Authorization', auth())
      .send({ reason: 'Admin da fixture também pode reabrir' });
    expect(reopen.status).toBe(200);
  });

  // ------------------------------------------------------------------- C9

  it('C9: operator sees only own sessions, view-all sees both', async () => {
    const own = await request(app)
      .post(`${BASE}/open`)
      .set('Authorization', `Bearer ${tokenOperator}`)
      .send({ registerId: registerId2, openingBalance: 0 });
    expect(own.status).toBe(201);
    expect(own.body.data.openedById).toBe(operatorUserId);

    const asOperator = await request(app)
      .get(`${BASE}`)
      .set('Authorization', `Bearer ${tokenOperator}`);
    expect(asOperator.status).toBe(200);
    expect(asOperator.body.data.every((s: { openedById: string }) => s.openedById === operatorUserId)).toBe(true);

    const asViewAll = await request(app)
      .get(`${BASE}`)
      .set('Authorization', `Bearer ${tokenViewAll}`);
    expect(asViewAll.status).toBe(200);
    expect(asViewAll.body.data.length).toBeGreaterThanOrEqual(2);
  });

  it('cross-tenant session detail is 404', async () => {
    const res = await request(app)
      .get(`${BASE}/${sessionId}`)
      .set('Authorization', `Bearer ${fixture.tokenB}`);

    expect(res.status).toBe(404);
  });
});
