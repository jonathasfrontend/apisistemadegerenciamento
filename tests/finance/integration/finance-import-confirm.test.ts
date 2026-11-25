/**
 * [F2.3] Revisão, confirmação e descarte do lote — spec §7.2
 * (FINANCEIRO_IMPLEMENTACAO.md:1219-1235).
 *
 * Cobertura:
 *  - PATCH /imports/:id/rows/:rowId (descrição, valor/data ⇒ regera dedupeKey H:, isIgnored);
 *  - POST /imports/:id/confirm com MISMATCH sem ack ⇒ 422 BALANCE_MISMATCH_ACK_REQUIRED;
 *  - confirm cria BankTransaction em UMA transação, atualiza contadores e lastImportAt;
 *  - duplicadas/ignoradas NÃO viram transação (reimportar o mesmo extrato ⇒ 0 novas);
 *  - DELETE de lote não confirmado ⇒ DISCARDED + arquivo apagado;
 *  - DELETE de lote CONFIRMADO com reconciliação ⇒ 409 IMPORT_HAS_RECONCILIATIONS;
 *  - isolamento por tenant (404) e RBAC (403).
 */
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import bcrypt from 'bcrypt';
import request from 'supertest';
import app from '../../../src/app';
import prisma from '../../../src/config/db';
import { env } from '../../../src/config/env';
import { seedTwoTenants, TenantFixture } from '../helpers/tenancy';

const IMPORTS = '/api/v1/finance/imports';

interface RowSeed {
  rowIndex: number;
  postedAt?: string;
  amount?: number;
  description?: string;
  dedupeKey?: string;
  isDuplicate?: boolean;
  isIgnored?: boolean;
}

const financeEnv = env as unknown as {
  financeFileKey: string;
  financeStorageDriver: string;
  financeStorageLocalPath: string;
};

describe('finance import review/confirm/discard (F2.3)', () => {
  let fixture: TenantFixture;
  let bankAccountId: string;
  let tokenNoPerm: string;
  let storageRoot: string;

  const createBatch = async (opts: {
    status?: 'READY' | 'NEEDS_REVIEW' | 'UPLOADED';
    balanceCheck?: 'OK' | 'MISMATCH' | 'UNAVAILABLE';
    rows?: RowSeed[];
    storageKey?: string | null;
    fileHash?: string;
  } = {}) => {
    const id = randomUUID();
    await prisma.importBatch.create({
      data: {
        id,
        companyId: fixture.companyAId,
        bankAccountId,
        fileName: `extrato-${id}.ofx`,
        fileSize: 128,
        fileHash: opts.fileHash ?? `hash-${id}`,
        storageKey: opts.storageKey ?? null,
        status: opts.status ?? 'READY',
        balanceCheck: opts.balanceCheck ?? 'OK',
        uploadedById: fixture.userAId,
      },
    });

    for (const row of opts.rows ?? []) {
      await prisma.importRow.create({
        data: {
          batchId: id,
          rowIndex: row.rowIndex,
          postedAt: new Date(`${row.postedAt ?? '2026-11-10'}T00:00:00.000Z`),
          amount: row.amount ?? 100,
          description: row.description ?? `Linha ${row.rowIndex}`,
          memo: null,
          dedupeKey: row.dedupeKey ?? `F:ID-${row.rowIndex}`,
          normalizedDescription: (row.description ?? `Linha ${row.rowIndex}`).toUpperCase(),
          inferredMethod: 'OTHER',
          isDuplicate: row.isDuplicate ?? false,
          possibleDuplicate: false,
          isIgnored: row.isIgnored ?? false,
          warnings: [],
        },
      });
    }
    return id;
  };

  const confirm = (batchId: string, token: string, body: Record<string, unknown> = {}) =>
    request(app)
      .post(`${IMPORTS}/${batchId}/confirm`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  beforeAll(async () => {
    fixture = await seedTwoTenants();
    const account = await prisma.bankAccount.create({
      data: {
        companyId: fixture.companyAId,
        name: `Conta Confirm ${fixture.suffix}`,
        initialBalance: 0,
        initialBalanceDate: new Date('2026-11-01T00:00:00.000Z'),
      },
    });
    bankAccountId = account.id;

    const permission = await prisma.permission.upsert({
      where: { name: 'clients.read' },
      update: {},
      create: { name: 'clients.read', description: 'clients.read', module: 'clients' },
    });
    const role = await prisma.role.create({
      data: {
        name: `SemConfirm-${fixture.suffix}`,
        isSystem: false,
        isActive: true,
        rolePermissions: { create: [{ permissionId: permission.id }] },
      },
    });
    const user = await prisma.user.create({
      data: {
        email: `sem-confirm-${fixture.suffix}@test.local`,
        passwordHash: await bcrypt.hash('teste123', 4),
        name: 'Sem Confirm',
        roleId: role.id,
        companyId: fixture.companyAId,
      },
    });
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'teste123' });
    tokenNoPerm = login.body.data.accessToken;

    storageRoot = join(tmpdir(), `finance-confirm-${fixture.suffix}`);
    mkdirSync(join(storageRoot, 'finance', fixture.companyAId), { recursive: true });
    financeEnv.financeFileKey = 'a'.repeat(64);
    financeEnv.financeStorageDriver = 'LOCAL';
    financeEnv.financeStorageLocalPath = storageRoot;
  });

  it('1. PATCH altera descrição sem mexer no dedupeKey F:', async () => {
    const batchId = await createBatch({ rows: [{ rowIndex: 0 }] });
    const row = await prisma.importRow.findFirstOrThrow({ where: { batchId } });

    const res = await request(app)
      .patch(`${IMPORTS}/${batchId}/rows/${row.id}`)
      .set('Authorization', `Bearer ${fixture.tokenA}`)
      .send({ description: 'Cliente Revisado' });

    expect(res.status).toBe(200);
    expect(res.body.data.description).toBe('Cliente Revisado');
    expect(res.body.data.normalizedDescription).toBe('CLIENTE REVISADO');
    expect(res.body.data.dedupeKey).toBe('F:ID-0');
  });

  it('2. PATCH de valor regera dedupeKey H:', async () => {
    const batchId = await createBatch({ rows: [{ rowIndex: 0, description: 'Original' }] });
    const row = await prisma.importRow.findFirstOrThrow({ where: { batchId } });

    const res = await request(app)
      .patch(`${IMPORTS}/${batchId}/rows/${row.id}`)
      .set('Authorization', `Bearer ${fixture.tokenA}`)
      .send({ amount: 250.75, description: 'Ajustado' });

    expect(res.status).toBe(200);
    expect(res.body.data.amount).toBe(250.75);
    expect(res.body.data.dedupeKey).toMatch(/^H:/);
  });

  it('3. PATCH de isIgnored marca a linha', async () => {
    const batchId = await createBatch({ rows: [{ rowIndex: 0 }] });
    const row = await prisma.importRow.findFirstOrThrow({ where: { batchId } });

    const res = await request(app)
      .patch(`${IMPORTS}/${batchId}/rows/${row.id}`)
      .set('Authorization', `Bearer ${fixture.tokenA}`)
      .send({ isIgnored: true });

    expect(res.status).toBe(200);
    expect(res.body.data.isIgnored).toBe(true);
  });

  it('4. MISMATCH sem acknowledge => 422 BALANCE_MISMATCH_ACK_REQUIRED', async () => {
    const batchId = await createBatch({ balanceCheck: 'MISMATCH', rows: [{ rowIndex: 0 }] });
    const res = await confirm(batchId, fixture.tokenA);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('BALANCE_MISMATCH_ACK_REQUIRED');
  });

  it('5. confirm com ack cria transações, fecha o lote e atualiza lastImportAt', async () => {
    const batchId = await createBatch({
      status: 'NEEDS_REVIEW',
      balanceCheck: 'MISMATCH',
      rows: [{ rowIndex: 0, amount: -10.5 }, { rowIndex: 1, amount: 1500 }],
    });

    const res = await confirm(batchId, fixture.tokenA, { acknowledgeMismatch: true });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('CONFIRMED');
    expect(res.body.data.created).toBe(2);

    const batch = await prisma.importBatch.findUniqueOrThrow({ where: { id: batchId } });
    expect(batch.status).toBe('CONFIRMED');
    expect(batch.confirmedById).toBe(fixture.userAId);
    expect(batch.confirmedAt).not.toBeNull();
    expect(batch.newRows).toBe(2);

    const txs = await prisma.bankTransaction.findMany({ where: { importBatchId: batchId } });
    expect(txs).toHaveLength(2);
    expect(txs.every((tx) => tx.companyId === fixture.companyAId)).toBe(true);
    expect(txs.every((tx) => tx.source === 'OFX')).toBe(true);

    const account = await prisma.bankAccount.findUniqueOrThrow({ where: { id: bankAccountId } });
    expect(account.lastImportAt).not.toBeNull();
  });

  it('6. duplicadas e ignoradas não viram transação (reimportar ⇒ 0 novas)', async () => {
    const batchId = await createBatch({
      rows: [
        { rowIndex: 0, dedupeKey: 'F:NOVA-1' },
        { rowIndex: 1, dedupeKey: 'F:NOVA-2', isDuplicate: true },
        { rowIndex: 2, dedupeKey: 'F:NOVA-3', isIgnored: true },
      ],
    });

    const res = await confirm(batchId, fixture.tokenA);
    expect(res.status).toBe(200);
    expect(res.body.data.created).toBe(1);

    const txs = await prisma.bankTransaction.findMany({ where: { importBatchId: batchId } });
    expect(txs).toHaveLength(1);
    expect(txs[0].dedupeKey).toBe('F:NOVA-1');

    // Mesmo dedupeKey vindo de outro lote não cria segunda transação.
    const again = await createBatch({ rows: [{ rowIndex: 0, dedupeKey: 'F:NOVA-1' }] });
    const resAgain = await confirm(again, fixture.tokenA);
    expect(resAgain.status).toBe(200);
    expect(resAgain.body.data.created).toBe(0);
    const txCount = await prisma.bankTransaction.count({
      where: { bankAccountId, dedupeKey: 'F:NOVA-1' },
    });
    expect(txCount).toBe(1);
  });

  it('7. DELETE de lote não confirmado => DISCARDED e arquivo apagado', async () => {
    const storageKey = `finance/${fixture.companyAId}/${randomUUID()}.ofx`;
    const storedPath = join(storageRoot, storageKey);
    writeFileSync(storedPath, Buffer.from('cifrado'));

    const batchId = await createBatch({ status: 'READY', storageKey });
    const res = await request(app)
      .delete(`${IMPORTS}/${batchId}`)
      .set('Authorization', `Bearer ${fixture.tokenA}`);

    expect(res.status).toBe(200);
    const batch = await prisma.importBatch.findUniqueOrThrow({ where: { id: batchId } });
    expect(batch.status).toBe('DISCARDED');
    expect(batch.storageKey).toBeNull();
    expect(existsSync(storedPath)).toBe(false);
  });

  it('8. DELETE de lote CONFIRMADO com reconciliação => 409 IMPORT_HAS_RECONCILIATIONS', async () => {
    const batchId = await createBatch({ rows: [{ rowIndex: 0, dedupeKey: 'F:RECON-1' }] });
    await confirm(batchId, fixture.tokenA);

    const tx = await prisma.bankTransaction.findFirstOrThrow({
      where: { importBatchId: batchId },
    });
    await prisma.reconciliation.create({
      data: {
        companyId: fixture.companyAId,
        bankTransactionId: tx.id,
        targetType: 'PAYMENT',
        paymentId: fixture.paymentAId,
        amount: 100,
        origin: 'MANUAL',
        createdById: fixture.userAId,
      },
    });

    const res = await request(app)
      .delete(`${IMPORTS}/${batchId}`)
      .set('Authorization', `Bearer ${fixture.tokenA}`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('IMPORT_HAS_RECONCILIATIONS');
  });

  it('9. confirmar lote de outro tenant => 404', async () => {
    const batchId = await createBatch({ rows: [{ rowIndex: 0 }] });
    const res = await confirm(batchId, fixture.tokenB);
    expect(res.status).toBe(404);
  });

  it('10. PATCH sem finance.bank.import => 403', async () => {
    const batchId = await createBatch({ rows: [{ rowIndex: 0 }] });
    const row = await prisma.importRow.findFirstOrThrow({ where: { batchId } });
    const res = await request(app)
      .patch(`${IMPORTS}/${batchId}/rows/${row.id}`)
      .set('Authorization', `Bearer ${tokenNoPerm}`)
      .send({ description: 'Não permitido' });
    expect(res.status).toBe(403);
  });

  it('11. lote FAILED não pode ser confirmado', async () => {
    const batchId = await createBatch({ rows: [{ rowIndex: 0 }] });
    await prisma.importBatch.update({ where: { id: batchId }, data: { status: 'FAILED' } });
    const res = await confirm(batchId, fixture.tokenA);
    expect(res.status).toBe(409);
  });
});
