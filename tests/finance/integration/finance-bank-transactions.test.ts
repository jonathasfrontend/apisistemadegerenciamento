/**
 * [F2.4] Extrato, lançamento manual e saldo real da conta — spec §7.5
 * (FINANCEIRO_IMPLEMENTACAO.md:1338-1342) e invariante I10 (:941).
 *
 * Cobertura:
 *  - GET /bank-transactions: filtros, ordenação, paginação, totais do filtro;
 *  - POST /bank-transactions: source=MANUAL, dedupe, duplicata e tenant;
 *  - GET /:id (detalhe + conciliações) e PATCH /:id (categoria/notas/IGNORED);
 *  - GET /bank-accounts/:id/balance: I10 com transações e `asOf`;
 *  - RBAC e isolamento por empresa; /finance/overview sem regressão.
 */
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcrypt';
import request from 'supertest';
import app from '../../../src/app';
import prisma from '../../../src/config/db';
import { normalizeDescription } from '../../../src/domain/finance/text';
import { seedTwoTenants, TenantFixture } from '../helpers/tenancy';

const BT = '/api/v1/finance/bank-transactions';

interface TxSeed {
  amount?: number;
  postedAt?: string;
  description?: string;
  method?: 'PIX' | 'TED' | 'DOC' | 'BOLETO' | 'CARD_SETTLEMENT' | 'FEE' | 'INTEREST' | 'CASH_DEPOSIT' | 'OTHER';
  status?: 'PENDING' | 'SUGGESTED' | 'PARTIAL' | 'RECONCILED' | 'IGNORED';
  categoryId?: string | null;
  dedupeKey?: string;
  source?: 'OFX' | 'MANUAL';
}

describe('finance bank transactions (F2.4)', () => {
  let fixture: TenantFixture;
  let listAccountId: string;
  let manualAccountId: string;
  let detailAccountId: string;
  let balanceAccountId: string;
  let accountBId: string;
  let categoryAId: string;
  let categoryBId: string;
  let txDetailId: string;
  let txOtherId: string;
  let txBId: string;
  let tokenNoPerm: string;

  const createAccount = async (companyId: string, name: string, initialBalance = 0) =>
    (
      await prisma.bankAccount.create({
        data: {
          companyId,
          name: `${name}-${fixture.suffix}`,
          initialBalance,
          initialBalanceDate: new Date('2026-11-01T00:00:00.000Z'),
        },
      })
    ).id;

  const seedTx = async (companyId: string, bankAccountId: string, opts: TxSeed = {}) => {
    const description = opts.description ?? `Transação ${randomUUID().slice(0, 8)}`;
    return prisma.bankTransaction.create({
      data: {
        companyId,
        bankAccountId,
        source: opts.source ?? 'OFX',
        dedupeKey: opts.dedupeKey ?? `F:${randomUUID()}`,
        postedAt: new Date(`${opts.postedAt ?? '2026-11-10'}T00:00:00.000Z`),
        amount: opts.amount ?? 100,
        description,
        normalizedDescription: normalizeDescription(description),
        inferredMethod: opts.method ?? 'OTHER',
        status: opts.status ?? 'PENDING',
        categoryId: opts.categoryId ?? null,
      },
    });
  };

  beforeAll(async () => {
    fixture = await seedTwoTenants();

    listAccountId = await createAccount(fixture.companyAId, 'Lista');
    manualAccountId = await createAccount(fixture.companyAId, 'Manual');
    detailAccountId = await createAccount(fixture.companyAId, 'Detalhe');
    balanceAccountId = await createAccount(fixture.companyAId, 'Saldo', 1000);
    accountBId = await createAccount(fixture.companyBId, 'TenantB');

    categoryAId = (
      await prisma.financialCategory.create({
        data: { companyId: fixture.companyAId, name: `Categoria A ${fixture.suffix}`, kind: 'EXPENSE' },
      })
    ).id;
    categoryBId = (
      await prisma.financialCategory.create({
        data: { companyId: fixture.companyBId, name: `Categoria B ${fixture.suffix}`, kind: 'EXPENSE' },
      })
    ).id;

    // 5 linhas: 3 PENDING, 1 IGNORED, 1 SUGGESTED; categoria só na primeira.
    await seedTx(fixture.companyAId, listAccountId, {
      amount: 1500,
      postedAt: '2026-11-10',
      description: 'Pix Recebido Cliente A',
      method: 'PIX',
      categoryId: categoryAId,
    });
    await seedTx(fixture.companyAId, listAccountId, {
      amount: -10.5,
      postedAt: '2026-11-11',
      description: 'Tarifa Bancária',
      method: 'FEE',
    });
    await seedTx(fixture.companyAId, listAccountId, {
      amount: -200,
      postedAt: '2026-11-12',
      description: 'Boleto Fornecedor',
      method: 'BOLETO',
      status: 'IGNORED',
    });
    await seedTx(fixture.companyAId, listAccountId, {
      amount: 50,
      postedAt: '2026-11-05',
      description: 'Depósito em Caixa',
      method: 'CASH_DEPOSIT',
      status: 'SUGGESTED',
    });

    txDetailId = (
      await seedTx(fixture.companyAId, detailAccountId, {
        amount: -10.5,
        postedAt: '2026-11-11',
        description: 'Tarifa com conciliação',
        method: 'FEE',
      })
    ).id;
    txOtherId = (
      await seedTx(fixture.companyAId, detailAccountId, {
        amount: 77,
        postedAt: '2026-11-12',
        description: 'Sem conciliação',
        method: 'PIX',
      })
    ).id;
    await prisma.reconciliation.create({
      data: {
        companyId: fixture.companyAId,
        bankTransactionId: txDetailId,
        targetType: 'PAYMENT',
        paymentId: fixture.paymentAId,
        amount: 10,
        score: 95,
        origin: 'MANUAL',
        createdById: fixture.userAId,
      },
    });
    // I4: cockpit recalcula reconciledAmount ao conciliar; aqui o fixture
    // reproduz o estado pós-conciliação para exercitar os campos derivados.
    await prisma.bankTransaction.update({
      where: { id: txDetailId },
      data: { reconciledAmount: 10, status: 'PARTIAL' },
    });

    txBId = (await seedTx(fixture.companyBId, accountBId, { amount: 999 })).id;

    // I10: +500 (11-05), −200 (11-10), +100 (10-31, antes da data inicial),
    // −50 (11-12, IGNORADA mas ainda movimento real do banco).
    await seedTx(fixture.companyAId, balanceAccountId, { amount: 500, postedAt: '2026-11-05' });
    await seedTx(fixture.companyAId, balanceAccountId, { amount: -200, postedAt: '2026-11-10' });
    await seedTx(fixture.companyAId, balanceAccountId, { amount: 100, postedAt: '2026-10-31' });
    await seedTx(fixture.companyAId, balanceAccountId, {
      amount: -50,
      postedAt: '2026-11-12',
      status: 'IGNORED',
    });

    const permission = await prisma.permission.findUniqueOrThrow({
      where: { name: 'clients.read' },
    });
    const role = await prisma.role.create({
      data: {
        name: `SemView-${fixture.suffix}`,
        isSystem: false,
        isActive: true,
        rolePermissions: { create: [{ permissionId: permission.id }] },
      },
    });
    const user = await prisma.user.create({
      data: {
        email: `sem-view-${fixture.suffix}@test.local`,
        passwordHash: await bcrypt.hash('teste123', 4),
        name: 'Sem View',
        roleId: role.id,
        companyId: fixture.companyAId,
      },
    });
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'teste123' });
    tokenNoPerm = login.body.data.accessToken;
  });

  const list = (query: Record<string, string>, token = fixture.tokenA) =>
    request(app).get(BT).query(query).set('Authorization', `Bearer ${token}`);

  it('1. lista ordenada por postedAt desc, paginada e com totais do filtro', async () => {
    const res = await list({ bankAccountId: listAccountId, from: '2026-11-01', to: '2026-11-30', limit: '2' });
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].postedAt).toContain('2026-11-12');
    expect(res.body.data[1].postedAt).toContain('2026-11-11');
    expect(res.body.pagination).toMatchObject({ page: 1, limit: 2, total: 4, totalPages: 2 });
    expect(res.body.totals).toEqual(expect.objectContaining({ totalIn: 1550, totalOut: 210.5 }));
    expect(res.body.data[0]).toEqual(
      expect.objectContaining({ reconciledAmount: 0, remaining: 200, suggestions: 0 })
    );
  });

  it('2. filtros direction, status, method, search normalizada, valor e categoria', async () => {
    const base = { bankAccountId: listAccountId };
    const expectCount = async (query: Record<string, string>, count: number) => {
      const res = await list({ ...base, ...query });
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(count);
    };

    await expectCount({ direction: 'IN' }, 2);
    await expectCount({ direction: 'OUT' }, 2);
    await expectCount({ status: 'IGNORED' }, 1);
    await expectCount({ status: 'SUGGESTED' }, 1);
    await expectCount({ method: 'FEE' }, 1);
    await expectCount({ search: 'cliente' }, 1); // "PIX RECEBIDO" é ruído; sobra "CLIENTE A"
    await expectCount({ minAmount: '1000', maxAmount: '1600' }, 1);
    await expectCount({ from: '2026-11-10', to: '2026-11-10' }, 1);
    await expectCount({ categoryId: categoryAId }, 1);
  });

  it('3. POST cria lançamento manual com source=MANUAL e dedupe H:', async () => {
    const res = await request(app)
      .post(BT)
      .set('Authorization', `Bearer ${fixture.tokenA}`)
      .send({
        bankAccountId: manualAccountId,
        postedAt: '2026-11-15',
        amount: 123.45,
        description: 'Pix Recebido Cliente Manual',
        memo: 'lançamento sem extrato',
      });

    expect(res.status).toBe(201);
    expect(res.body.data).toEqual(
      expect.objectContaining({
        source: 'MANUAL',
        status: 'PENDING',
        amount: 123.45,
        normalizedDescription: normalizeDescription('Pix Recebido Cliente Manual'),
        memo: 'lançamento sem extrato',
      })
    );
    expect(res.body.data.dedupeKey).toMatch(/^H:/);
  });

  it('4. POST duplicado => 409 BANK_TRANSACTION_DUPLICATE', async () => {
    const body = {
      bankAccountId: manualAccountId,
      postedAt: '2026-11-16',
      amount: 88.9,
      description: 'Duplicata Manual',
    };
    const first = await request(app)
      .post(BT)
      .set('Authorization', `Bearer ${fixture.tokenA}`)
      .send(body);
    expect(first.status).toBe(201);

    const second = await request(app)
      .post(BT)
      .set('Authorization', `Bearer ${fixture.tokenA}`)
      .send(body);
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('BANK_TRANSACTION_DUPLICATE');
  });

  it('5. POST em conta de outro tenant => 404 BANK_ACCOUNT_NOT_FOUND', async () => {
    const res = await request(app)
      .post(BT)
      .set('Authorization', `Bearer ${fixture.tokenA}`)
      .send({ bankAccountId: accountBId, postedAt: '2026-11-17', amount: 10, description: 'Invasão' });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('BANK_ACCOUNT_NOT_FOUND');
  });

  it('6. GET /:id devolve detalhe com conciliações e valores derivados', async () => {
    const res = await request(app)
      .get(`${BT}/${txDetailId}`)
      .set('Authorization', `Bearer ${fixture.tokenA}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(txDetailId);
    expect(res.body.data.reconciledAmount).toBe(10);
    expect(res.body.data.remaining).toBe(0.5);
    expect(res.body.data.reconciliations).toHaveLength(1);
    expect(res.body.data.reconciliations[0]).toEqual(
      expect.objectContaining({ targetType: 'PAYMENT', targetId: fixture.paymentAId, amount: 10 })
    );
  });

  it('7. PATCH altera categoria e notas sem tocar na conciliação', async () => {
    const res = await request(app)
      .patch(`${BT}/${txDetailId}`)
      .set('Authorization', `Bearer ${fixture.tokenA}`)
      .send({ categoryId: categoryAId, notes: 'Conferido' });

    expect(res.status).toBe(200);
    expect(res.body.data.categoryId).toBe(categoryAId);
    expect(res.body.data.notes).toBe('Conferido');
    const stored = await prisma.bankTransaction.findUniqueOrThrow({ where: { id: txDetailId } });
    expect(stored.categoryId).toBe(categoryAId);
    expect(await prisma.reconciliation.count({ where: { bankTransactionId: txDetailId } })).toBe(1);
  });

  it('8. PATCH IGNORED em transação conciliada => 409', async () => {
    const res = await request(app)
      .patch(`${BT}/${txDetailId}`)
      .set('Authorization', `Bearer ${fixture.tokenA}`)
      .send({ status: 'IGNORED' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('BANK_TRANSACTION_HAS_RECONCILIATIONS');
  });

  it('9. PATCH IGNORED e volta para PENDING em transação sem conciliação', async () => {
    const ignored = await request(app)
      .patch(`${BT}/${txOtherId}`)
      .set('Authorization', `Bearer ${fixture.tokenA}`)
      .send({ status: 'IGNORED' });
    expect(ignored.status).toBe(200);
    expect(ignored.body.data.status).toBe('IGNORED');

    const back = await request(app)
      .patch(`${BT}/${txOtherId}`)
      .set('Authorization', `Bearer ${fixture.tokenA}`)
      .send({ status: 'PENDING' });
    expect(back.status).toBe(200);
    expect(back.body.data.status).toBe('PENDING');
  });

  it('10. PATCH com categoria de outro tenant => 404 CATEGORY_NOT_FOUND', async () => {
    const res = await request(app)
      .patch(`${BT}/${txOtherId}`)
      .set('Authorization', `Bearer ${fixture.tokenA}`)
      .send({ categoryId: categoryBId });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('CATEGORY_NOT_FOUND');
  });

  it('11. RBAC: 403 sem finance.bank.view / finance.bank.import / finance.reconcile', async () => {
    expect((await list({}, tokenNoPerm)).status).toBe(403);
    expect(
      (
        await request(app)
          .post(BT)
          .set('Authorization', `Bearer ${tokenNoPerm}`)
          .send({ bankAccountId: manualAccountId, amount: 1, postedAt: '2026-11-20', description: 'x' })
      ).status
    ).toBe(403);
    expect(
      (
        await request(app)
          .patch(`${BT}/${txOtherId}`)
          .set('Authorization', `Bearer ${tokenNoPerm}`)
          .send({ notes: 'x' })
      ).status
    ).toBe(403);
  });

  it('12. isolamento: conta e transação do tenant B invisíveis para o tenant A', async () => {
    const listRes = await list({ bankAccountId: accountBId });
    expect(listRes.status).toBe(200);
    expect(listRes.body.data).toHaveLength(0);
    expect(listRes.body.pagination.total).toBe(0);

    const detailRes = await request(app)
      .get(`${BT}/${txBId}`)
      .set('Authorization', `Bearer ${fixture.tokenA}`);
    expect(detailRes.status).toBe(404);
  });

  it('13. saldo I10 = inicial + Σ transações desde a data inicial (IGNORED incluída)', async () => {
    const res = await request(app)
      .get(`/api/v1/finance/bank-accounts/${balanceAccountId}/balance`)
      .set('Authorization', `Bearer ${fixture.tokenA}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(
      expect.objectContaining({
        balance: 1250,
        initialBalance: 1000,
        source: 'BANK_TRANSACTIONS',
        transactionCount: 3,
        totalIn: 500,
        totalOut: 250,
      })
    );
    expect(res.body.data.note).toBe('Saldo calculado por I10 (saldo inicial + transações bancárias no período).');
  });

  it('14. saldo com asOf respeita a data; sem transações source permanece F1', async () => {
    const asOf = await request(app)
      .get(`/api/v1/finance/bank-accounts/${balanceAccountId}/balance`)
      .query({ asOf: '2026-11-09' })
      .set('Authorization', `Bearer ${fixture.tokenA}`);
    expect(asOf.status).toBe(200);
    expect(asOf.body.data.balance).toBe(1500);

    const before = await request(app)
      .get(`/api/v1/finance/bank-accounts/${balanceAccountId}/balance`)
      .query({ asOf: '2026-10-31' })
      .set('Authorization', `Bearer ${fixture.tokenA}`);
    expect(before.status).toBe(200);
    expect(before.body.data.balance).toBe(1000);
    expect(before.body.data.source).toBe('F1_INITIAL_BALANCE_ONLY');
    expect(before.body.data.note).toBe('Sem transações no período; exibido saldo inicial.');
  });

  it('15. /finance/overview sem regressão com o novo cálculo de saldo', async () => {
    const res = await request(app)
      .get('/api/v1/finance/overview')
      .query({ from: '2026-11-01', to: '2026-11-30' })
      .set('Authorization', `Bearer ${fixture.tokenA}`);

    expect(res.status).toBe(200);
    const account = res.body.data.bankBalances.accounts.find(
      (a: { id: string }) => a.id === balanceAccountId
    );
    expect(account).toEqual(expect.objectContaining({ balance: 1250 }));
  });

  it('16. postedAt com dia de calendário inexistente => 400 (não normaliza a data)', async () => {
    const res = await request(app)
      .post(BT)
      .set('Authorization', `Bearer ${fixture.tokenA}`)
      .send({
        bankAccountId: manualAccountId,
        postedAt: '2026-02-30',
        amount: 10,
        description: 'Data impossível',
      });
    expect(res.status).toBe(400);
  });

  it('17. filtros from/to com dia de calendário inexistente => 400', async () => {
    const from = await list({ bankAccountId: listAccountId, from: '2026-02-30' });
    expect(from.status).toBe(400);
    const to = await list({ bankAccountId: listAccountId, to: '2026-11-31' });
    expect(to.status).toBe(400);
  });

  it('18. asOf aceita só YYYY-MM-DD com calendário válido', async () => {
    const route = `/api/v1/finance/bank-accounts/${balanceAccountId}/balance`;
    for (const asOf of ['123', '2026/11/10', '2026-02-30']) {
      const res = await request(app)
        .get(route)
        .query({ asOf })
        .set('Authorization', `Bearer ${fixture.tokenA}`);
      expect(res.status).toBe(400);
    }
  });

  it('19. amount com mais de 2 casas ou acima do teto Decimal(14,2) => 400', async () => {
    const base = {
      bankAccountId: manualAccountId,
      postedAt: '2026-11-21',
      description: 'Valor inválido',
    };
    const threeDecimals = await request(app)
      .post(BT)
      .set('Authorization', `Bearer ${fixture.tokenA}`)
      .send({ ...base, amount: 1.005 });
    expect(threeDecimals.status).toBe(400);

    const overflow = await request(app)
      .post(BT)
      .set('Authorization', `Bearer ${fixture.tokenA}`)
      .send({ ...base, amount: 1e12 });
    expect(overflow.status).toBe(400);
  });

  it('20. PATCH em transação de outro tenant => 404', async () => {
    const res = await request(app)
      .patch(`${BT}/${txBId}`)
      .set('Authorization', `Bearer ${fixture.tokenA}`)
      .send({ notes: 'Invasão' });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('BANK_TRANSACTION_NOT_FOUND');
  });

  it('21. PENDING bloqueado quando há valor conciliado mesmo sem linha de reconciliação', async () => {
    const tx = await seedTx(fixture.companyAId, detailAccountId, {
      amount: 80,
      description: 'Legado parcial',
      status: 'IGNORED',
    });
    await prisma.bankTransaction.update({
      where: { id: tx.id },
      data: { reconciledAmount: 30, status: 'IGNORED' },
    });

    const res = await request(app)
      .patch(`${BT}/${tx.id}`)
      .set('Authorization', `Bearer ${fixture.tokenA}`)
      .send({ status: 'PENDING' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('BANK_TRANSACTION_STATUS_INVALID');
  });

  it('22. saldo reflete lançamento manual criado pela API', async () => {
    const accountId = await createAccount(fixture.companyAId, 'Saldo Manual', 200);
    const created = await request(app)
      .post(BT)
      .set('Authorization', `Bearer ${fixture.tokenA}`)
      .send({
        bankAccountId: accountId,
        postedAt: '2026-11-22',
        amount: 350.75,
        description: 'Depósito manual',
      });
    expect(created.status).toBe(201);

    const balance = await request(app)
      .get(`/api/v1/finance/bank-accounts/${accountId}/balance`)
      .set('Authorization', `Bearer ${fixture.tokenA}`);
    expect(balance.status).toBe(200);
    expect(balance.body.data).toEqual(
      expect.objectContaining({ balance: 550.75, source: 'BANK_TRANSACTIONS', transactionCount: 1 })
    );
  });

  it('24. asOf date-only inclui transações no próprio dia (corte fim do dia UTC)', async () => {
    const accountId = await createAccount(fixture.companyAId, 'Saldo asOf mesmo dia', 100);
    const description = `Mesmo dia ${randomUUID().slice(0, 8)}`;
    await prisma.bankTransaction.create({
      data: {
        companyId: fixture.companyAId,
        bankAccountId: accountId,
        source: 'OFX',
        dedupeKey: `F:${randomUUID()}`,
        postedAt: new Date('2026-11-24T18:30:00.000Z'),
        amount: 250,
        description,
        normalizedDescription: normalizeDescription(description),
        inferredMethod: 'OTHER',
        status: 'PENDING',
      },
    });

    const res = await request(app)
      .get(`/api/v1/finance/bank-accounts/${accountId}/balance`)
      .query({ asOf: '2026-11-24' })
      .set('Authorization', `Bearer ${fixture.tokenA}`);
    expect(res.status).toBe(200);
    expect(res.body.data.balance).toBe(350);
  });

  it('23. página 2 e totals.net sobre todo o filtro', async () => {
    const res = await list({
      bankAccountId: listAccountId,
      from: '2026-11-01',
      to: '2026-11-30',
      limit: '2',
      page: '2',
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.pagination).toMatchObject({ page: 2, limit: 2, total: 4 });
    expect(res.body.totals).toEqual(
      expect.objectContaining({ totalIn: 1550, totalOut: 210.5, net: 1339.5 })
    );
  });
});
