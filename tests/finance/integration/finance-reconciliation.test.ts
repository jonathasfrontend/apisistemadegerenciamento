/**
 * [F2.5] Motor de conciliação — spec §7.6 (FINANCEIRO_IMPLEMENTACAO.md:1346-1453)
 * e invariantes I3–I6 (:934-937).
 *
 * Cobertura: 1:1, parcial, 1:N cartão, desfazer (com/sem lançamento criado),
 * create-entry saída/entrada, transferência, limites, RBAC, tenant, summary,
 * bulk-confirm e 50 operações determinísticas validando I3–I6.
 */
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcrypt';
import request from 'supertest';
import app from '../../../src/app';
import prisma from '../../../src/config/db';
import { fromCents, toCents } from '../../../src/domain/finance/money';
import { normalizeDescription } from '../../../src/domain/finance/text';
import { seedTwoTenants, TenantFixture } from '../helpers/tenancy';

const BT = '/api/v1/finance/bank-transactions';
const REC = '/api/v1/finance/reconciliation';

const at = (date: string) => new Date(`${date}T00:00:00.000Z`);

describe('finance reconciliation (F2.5)', () => {
  let f: TenantFixture;
  let accountA: string;
  let accountA2: string;
  let accountB: string;
  let expenseCategory: string;
  let incomeCategory: string;
  let supplierId: string;
  let acquirerId: string;
  let clientAna: string;
  let tokenNoPerm: string;

  const createAccount = async (companyId: string, name: string) =>
    (
      await prisma.bankAccount.create({
        data: {
          companyId,
          name: `${name}-${f.suffix}`,
          initialBalance: 0,
          initialBalanceDate: at('2026-11-01'),
        },
      })
    ).id;

  const seedTx = async (opts: {
    companyId?: string;
    bankAccountId?: string;
    cents: number;
    date?: string;
    description?: string;
    method?: any;
    status?: any;
    dedupeKey?: string;
  }) => {
    const description = opts.description ?? `Lancamento ${randomUUID().slice(0, 8)}`;
    return prisma.bankTransaction.create({
      data: {
        companyId: opts.companyId ?? f.companyAId,
        bankAccountId: opts.bankAccountId ?? accountA,
        source: 'OFX',
        dedupeKey: opts.dedupeKey ?? `F:${randomUUID()}`,
        postedAt: at(opts.date ?? '2026-11-18'),
        amount: fromCents(opts.cents),
        description,
        normalizedDescription: normalizeDescription(description),
        inferredMethod: opts.method ?? 'PIX',
        status: opts.status ?? 'PENDING',
      },
    });
  };

  const seedPayment = async (opts: {
    companyId?: string;
    clientId?: string;
    cents: number;
    date?: string;
    method?: any;
    bankAccountId?: string | null;
  }) =>
    prisma.payment.create({
      data: {
        companyId: opts.companyId ?? f.companyAId,
        clientId: opts.clientId ?? clientAna,
        amount: opts.cents / 100,
        method: opts.method ?? 'PIX',
        status: 'PAID',
        paidAt: at(opts.date ?? '2026-11-18'),
        bankAccountId: opts.bankAccountId ?? null,
      },
    });

  const seedExpense = async (opts: {
    companyId?: string;
    cents: number;
    date?: string;
    accountId?: string;
    method?: any;
    description?: string;
  }) =>
    prisma.expense.create({
      data: {
        companyId: opts.companyId ?? f.companyAId,
        description: opts.description ?? `Despesa ${randomUUID().slice(0, 8)}`,
        category: 'Operacional',
        categoryId: expenseCategory,
        supplierId,
        amount: Math.abs(opts.cents) / 100,
        dueDate: at(opts.date ?? '2026-11-18'),
        paidDate: at(opts.date ?? '2026-11-18'),
        isPaid: true,
        paidAmount: fromCents(Math.abs(opts.cents)),
        paymentMethod: opts.method ?? 'DEBIT',
        bankAccountId: opts.accountId ?? accountA,
      },
    });

  const seedReceivable = async (opts: {
    paymentId: string;
    cents: number;
    date?: string;
    n?: number;
  }) =>
    prisma.cardReceivable.create({
      data: {
        companyId: f.companyAId,
        paymentId: opts.paymentId,
        acquirerId,
        installmentNumber: opts.n ?? 1,
        installmentTotal: 3,
        grossAmount: fromCents(opts.cents),
        feeAmount: fromCents(0),
        netAmount: fromCents(opts.cents),
        expectedDate: at(opts.date ?? '2026-11-18'),
      },
    });

  const reconcile = (id: string, targets: any[], token = f.tokenA, extra: any = {}) =>
    request(app)
      .post(`${BT}/${id}/reconcile`)
      .set('Authorization', `Bearer ${token}`)
      .send({ targets, ...extra });

  beforeAll(async () => {
    f = await seedTwoTenants();
    accountA = await createAccount(f.companyAId, 'Recon A');
    accountA2 = await createAccount(f.companyAId, 'Recon A2');
    accountB = await createAccount(f.companyBId, 'Recon B');

    expenseCategory = (
      await prisma.financialCategory.create({
        data: { companyId: f.companyAId, name: `Despesa ${f.suffix}`, kind: 'EXPENSE' },
      })
    ).id;
    incomeCategory = (
      await prisma.financialCategory.create({
        data: { companyId: f.companyAId, name: `Receita ${f.suffix}`, kind: 'INCOME' },
      })
    ).id;
    supplierId = (
      await prisma.supplier.create({
        data: { companyId: f.companyAId, name: `Fornecedor ${f.suffix}` },
      })
    ).id;
    acquirerId = (
      await prisma.acquirer.create({
        data: { companyId: f.companyAId, name: `Adquirente ${f.suffix}`, bankKeywords: ['ADQ'] },
      })
    ).id;
    clientAna = (
      await prisma.client.create({
        data: {
          companyId: f.companyAId,
          name: `Ana Silva Santos ${f.suffix}`,
          phone: `219${f.suffix.slice(0, 9)}`,
        },
      })
    ).id;

    const roleNoPerm = await prisma.role.create({
      data: { name: `SemPerm-${f.suffix}`, isSystem: false, isActive: true },
    });
    const userNoPerm = await prisma.user.create({
      data: {
        email: `sem-perm-${f.suffix}@test.local`,
        passwordHash: await bcrypt.hash('teste123', 4),
        name: 'Sem Permissão',
        roleId: roleNoPerm.id,
        companyId: f.companyAId,
      },
    });
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: userNoPerm.email, password: 'teste123' });
    tokenNoPerm = login.body.data.accessToken;
  });

  it('reconcilia 1:1 e marca o alvo (I3/I4/I5)', async () => {
    const tx = await seedTx({ cents: 12000, description: 'Pix Recebido Ana Silva' });
    const payment = await seedPayment({ cents: 12000, method: 'PIX' });

    const res = await reconcile(tx.id, [{ targetType: 'PAYMENT', targetId: payment.id, amount: 120 }]);
    expect(res.status).toBe(200);
    expect(res.body.data.transaction.status).toBe('RECONCILED');
    expect(res.body.data.transaction.reconciledAmount).toBe(120);

    const after = await prisma.bankTransaction.findUniqueOrThrow({ where: { id: tx.id }, include: { reconciliations: true } });
    expect(toCents(after.reconciledAmount)).toBe(12000);
    expect(after.reconciliations).toHaveLength(1);
    expect(toCents(after.reconciliations[0].amount)).toBe(12000);

    const p = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(p.isReconciled).toBe(true);
    expect(p.reconciledAt).not.toBeNull();

    const log = await prisma.auditLog.findFirst({
      where: { companyId: f.companyAId, entity: 'bank_transaction', entityId: tx.id, action: 'RECONCILE' },
    });
    expect(log).not.toBeNull();
  });

  it('aceita duas transações conciliando um mesmo alvo (alvo parcial → total)', async () => {
    const expense = await seedExpense({ cents: 12000 });
    const t1 = await seedTx({ cents: -6000, method: 'TED', date: '2026-11-18' });
    const t2 = await seedTx({ cents: -6000, method: 'TED', date: '2026-11-19' });

    expect((await reconcile(t1.id, [{ targetType: 'EXPENSE', targetId: expense.id, amount: 60 }])).status).toBe(200);
    const afterFirst = await prisma.expense.findUniqueOrThrow({ where: { id: expense.id } });
    expect(afterFirst.isReconciled).toBe(false);

    expect((await reconcile(t2.id, [{ targetType: 'EXPENSE', targetId: expense.id, amount: 60 }])).status).toBe(200);
    const afterSecond = await prisma.expense.findUniqueOrThrow({ where: { id: expense.id } });
    expect(afterSecond.isReconciled).toBe(true);
    // I4: cada transação está 100% alocada (6000/6000) ⇒ RECONCILED.
    // O que era parcial até aqui era o ALVO, não a transação.
    expect((await prisma.bankTransaction.findUniqueOrThrow({ where: { id: t1.id } })).status).toBe('RECONCILED');
    expect((await prisma.bankTransaction.findUniqueOrThrow({ where: { id: t2.id } })).status).toBe('RECONCILED');
  });

  it('casa 1:N de cartão e marca todos os recebíveis + o Payment (I6)', async () => {
    const tx = await seedTx({ cents: 10000, method: 'CARD_SETTLEMENT', description: 'Repasse ADQ Vendas' });
    const payment = await seedPayment({ cents: 10000, method: 'CREDIT' });
    const r1 = await seedReceivable({ paymentId: payment.id, cents: 4000, n: 1 });
    const r2 = await seedReceivable({ paymentId: payment.id, cents: 3000, n: 2 });
    const r3 = await seedReceivable({ paymentId: payment.id, cents: 3000, n: 3 });

    const suggestions = await request(app)
      .get(`${BT}/${tx.id}/suggestions`)
      .set('Authorization', `Bearer ${f.tokenA}`);
    expect(suggestions.status).toBe(200);
    expect(suggestions.body.data.suggestions[0].targetType).toBe('CARD_RECEIVABLE');
    expect(suggestions.body.data.suggestions).toHaveLength(3);

    const res = await reconcile(tx.id, [r1, r2, r3].map((r) => ({
      targetType: 'CARD_RECEIVABLE',
      targetId: r.id,
      amount: toCents(r.netAmount) / 100,
    })), f.tokenA, { origin: 'MANUAL' });
    expect(res.status).toBe(200);
    expect(res.body.data.transaction.status).toBe('RECONCILED');

    const receivables = await prisma.cardReceivable.findMany({ where: { paymentId: payment.id } });
    expect(receivables.every((r) => r.isReconciled)).toBe(true);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).isReconciled).toBe(true);
  });

  it('desfaz conciliação e recalcula flags/status', async () => {
    const tx = await seedTx({ cents: 5000 });
    const payment = await seedPayment({ cents: 5000 });
    await reconcile(tx.id, [{ targetType: 'PAYMENT', targetId: payment.id, amount: 50 }]);

    const res = await request(app)
      .delete(`${BT}/${tx.id}/reconcile`)
      .set('Authorization', `Bearer ${f.tokenA}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('PENDING');
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).isReconciled).toBe(false);
    expect(await prisma.reconciliation.count({ where: { bankTransactionId: tx.id } })).toBe(0);

    const log = await prisma.auditLog.findFirst({
      where: { entityId: tx.id, action: 'UNRECONCILE' },
    });
    expect(log).not.toBeNull();
  });

  it('cria Expense a partir de tarifa e concilia junto', async () => {
    const tx = await seedTx({ cents: -2500, method: 'FEE', description: 'Tarifa Pacote' });
    const res = await request(app)
      .post(`${BT}/${tx.id}/create-entry`)
      .set('Authorization', `Bearer ${f.tokenA}`)
      .send({ description: 'Tarifa bancária', categoryId: expenseCategory });
    expect(res.status).toBe(201);

    const expense = await prisma.expense.findUniqueOrThrow({ where: { id: res.body.data.entry.id } });
    expect(expense.source).toBe('BANK_RECONCILIATION');
    expect(expense.isPaid).toBe(true);
    expect(expense.isReconciled).toBe(true);
    expect(expense.paidDate?.toISOString().slice(0, 10)).toBe('2026-11-18');
    expect((await prisma.bankTransaction.findUniqueOrThrow({ where: { id: tx.id } })).status).toBe('RECONCILED');
  });

  it('cria OtherIncome a partir de entrada e concilia junto', async () => {
    const tx = await seedTx({ cents: 4000, description: 'Juros Creditados', method: 'INTEREST' });
    const res = await request(app)
      .post(`${BT}/${tx.id}/create-entry`)
      .set('Authorization', `Bearer ${f.tokenA}`)
      .send({ description: 'Rendimento', categoryId: incomeCategory });
    expect(res.status).toBe(201);
    expect(res.body.data.entry.source).toBe('BANK_RECONCILIATION');
    const income = await prisma.otherIncome.findUniqueOrThrow({ where: { id: res.body.data.entry.id } });
    expect(income.isReconciled).toBe(true);
  });

  it('deleteCreatedEntries apaga o lançamento criado', async () => {
    const tx = await seedTx({ cents: -1200, method: 'FEE' });
    const created = await request(app)
      .post(`${BT}/${tx.id}/create-entry`)
      .set('Authorization', `Bearer ${f.tokenA}`)
      .send({ description: 'Tarifa temporária', categoryId: expenseCategory });
    const entryId = created.body.data.entry.id;

    const without = await request(app)
      .delete(`${BT}/${tx.id}/reconcile`)
      .set('Authorization', `Bearer ${f.tokenA}`)
      .send({});
    expect(without.status).toBe(200);
    expect(await prisma.expense.count({ where: { id: entryId } })).toBe(1);

    await reconcile(tx.id, [{ targetType: 'EXPENSE', targetId: entryId, amount: 12 }]);
    const withFlag = await request(app)
      .delete(`${BT}/${tx.id}/reconcile`)
      .set('Authorization', `Bearer ${f.tokenA}`)
      .send({ deleteCreatedEntries: true });
    expect(withFlag.status).toBe(200);
    expect(await prisma.expense.count({ where: { id: entryId } })).toBe(0);
  });

  it('reconcilia transferência entre contas da mesma empresa', async () => {
    const out = await seedTx({ cents: -20000, bankAccountId: accountA, method: 'TED' });
    const incoming = await seedTx({ cents: 20000, bankAccountId: accountA2, method: 'TED' });
    const res = await reconcile(out.id, [{ targetType: 'TRANSFER', targetId: incoming.id, amount: 200 }]);
    expect(res.status).toBe(200);

    const a = await prisma.bankTransaction.findUniqueOrThrow({ where: { id: out.id } });
    const b = await prisma.bankTransaction.findUniqueOrThrow({ where: { id: incoming.id } });
    expect(a.transferPairId).toBe(incoming.id);
    expect(b.transferPairId).toBe(out.id);
    expect(a.status).toBe('RECONCILED');
    expect(b.status).toBe('RECONCILED');
    expect((await prisma.reconciliation.findFirst({ where: { bankTransactionId: out.id } }))?.targetType).toBe('TRANSFER');
  });

  it('rejeita soma acima do valor com 422', async () => {
    const tx = await seedTx({ cents: -10000 });
    const expense = await seedExpense({ cents: 20000 });
    const res = await reconcile(tx.id, [{ targetType: 'EXPENSE', targetId: expense.id, amount: 101 }]);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('RECONCILE_AMOUNT_EXCEEDS');
    expect(await prisma.reconciliation.count({ where: { bankTransactionId: tx.id } })).toBe(0);
  });

  it('bloqueia alvo de outra empresa e transação de outra empresa', async () => {
    const tx = await seedTx({ cents: 7000 });
    const foreign = await seedPayment({ companyId: f.companyBId, cents: 7000 });
    const res = await reconcile(tx.id, [{ targetType: 'PAYMENT', targetId: foreign.id, amount: 70 }]);
    expect(res.status).toBe(404);

    const foreignTx = await request(app).delete(`${BT}/${tx.id}/reconcile`).set('Authorization', `Bearer ${f.tokenB}`).send({});
    expect(foreignTx.status).toBe(404);

    const txB = await seedTx({ companyId: f.companyBId, bankAccountId: accountB, cents: 7000 });
    const paymentA = await seedPayment({ cents: 7000 });
    const cross = await reconcile(txB.id, [{ targetType: 'PAYMENT', targetId: paymentA.id, amount: 70 }], f.tokenB);
    expect(cross.status).toBe(404);
  });

  it('exige finance.reconcile', async () => {
    const tx = await seedTx({ cents: 3000 });
    const payment = await seedPayment({ cents: 3000 });
    const res = await reconcile(tx.id, [{ targetType: 'PAYMENT', targetId: payment.id, amount: 30 }], tokenNoPerm);
    expect(res.status).toBe(403);
  });

  it('devolve summary por status', async () => {
    const tx = await seedTx({ cents: 8000, status: 'PENDING' });
    const payment = await seedPayment({ cents: 8000 });
    await reconcile(tx.id, [{ targetType: 'PAYMENT', targetId: payment.id, amount: 80 }]);

    const res = await request(app).get(REC + '/summary').set('Authorization', `Bearer ${f.tokenA}`);
    expect(res.status).toBe(200);
    expect(res.body.data.reconciled).toBeGreaterThanOrEqual(1);
    expect(res.body.data.totalReconciledCents).toBeGreaterThanOrEqual(8000);
  });

  it('bulk-confirm reconcilia sugestões com score >= 50', async () => {
    const tx = await seedTx({ cents: 9000, description: 'Pix Recebido Ana Silva' });
    const payment = await seedPayment({ cents: 9000, method: 'PIX' });
    const res = await request(app)
      .post(`${BT}/bulk-confirm`)
      .set('Authorization', `Bearer ${f.tokenA}`)
      .send({ ids: [tx.id] });
    expect(res.status).toBe(200);
    expect(res.body.data.results[0].reconciled).toBe(true);
    expect((await prisma.bankTransaction.findUniqueOrThrow({ where: { id: tx.id } })).status).toBe('RECONCILED');
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).isReconciled).toBe(true);
  });

  it('mantém I3–I6 após 50 operações determinísticas de conciliar/desfazer', async () => {
    let seed = 20261125;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

    const pairs: { txId: string; paymentId: string; cents: number }[] = [];
    for (let i = 0; i < 10; i += 1) {
      const cents = 1000 + i * 100;
      const tx = await seedTx({ cents, dedupeKey: `F:inv-${f.suffix}-${i}` });
      const payment = await seedPayment({ cents, method: 'PIX' });
      pairs.push({ txId: tx.id, paymentId: payment.id, cents });
    }

    for (let step = 0; step < 50; step += 1) {
      const p = pairs[step % pairs.length];
      const amount = rnd() > 0.5 ? p.cents / 100 : (p.cents - 100) / 100;
      if (step % 3 === 2) {
        await request(app).delete(`${BT}/${p.txId}/reconcile`).set('Authorization', `Bearer ${f.tokenA}`).send({});
      } else {
        const res = await reconcile(p.txId, [{ targetType: 'PAYMENT', targetId: p.paymentId, amount }]);
        expect([200, 422]).toContain(res.status);
      }
    }

    for (const p of pairs) {
      const tx = await prisma.bankTransaction.findUniqueOrThrow({
        where: { id: p.txId },
        include: { reconciliations: true },
      });
      const sum = tx.reconciliations.reduce((acc, r) => acc + toCents(r.amount), 0);
      const absolute = Math.abs(toCents(tx.amount));
      expect(sum).toBeLessThanOrEqual(absolute); // I3
      if (sum === 0) expect(['PENDING', 'SUGGESTED', 'IGNORED']).toContain(tx.status); // I4
      else if (sum === absolute) expect(tx.status).toBe('RECONCILED');
      else expect(tx.status).toBe('PARTIAL');
      expect(toCents(tx.reconciledAmount)).toBe(sum);

      const payment = await prisma.payment.findUniqueOrThrow({ where: { id: p.paymentId } });
      const targetSum = tx.reconciliations
        .filter((r) => r.paymentId === p.paymentId)
        .reduce((acc, r) => acc + toCents(r.amount), 0);
      expect(targetSum).toBeLessThanOrEqual(toCents(payment.amount)); // I5
      expect(payment.isReconciled).toBe(sum === absolute);
    }
  });
});
