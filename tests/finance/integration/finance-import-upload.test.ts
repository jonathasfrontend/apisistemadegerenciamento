/**
 * [F2.2] Upload + lote de importação — spec §7.1 (FINANCEIRO_IMPLEMENTACAO.md:1207-1218)
 * e §7.4 (1315-1328).
 *
 * Cobertura:
 *  - 415 `IMPORT_UNSUPPORTED_FILE` (conteúdo não OFX e PDF ainda sem parser na F2);
 *  - 413 `IMPORT_TOO_LARGE` (limite por formato);
 *  - 503 `IMPORT_STORAGE_NOT_CONFIGURED` (sem `FINANCE_FILE_KEY`);
 *  - 429 `IMPORT_RATE_LIMITED` (20 uploads/hora/empresa, configurável);
 *  - 403 sem `finance.bank.import`;
 *  - 202 `{batchId, status:'UPLOADED'}` + arquivo criptografado + hash sha256;
 *  - 200 com aviso `IMPORT_ALREADY_IMPORTED` quando o mesmo hash já foi CONFIRMADO;
 *  - `companyId` do body é ignorado (vem do `req.user`);
 *  - runner do job: staging das linhas, método inferido, dedupe, saldo;
 *  - isolamento: `GET /imports/:id` de outro tenant => 404.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import bcrypt from 'bcrypt';
import request from 'supertest';
import app from '../../../src/app';
import prisma from '../../../src/config/db';
import { env } from '../../../src/config/env';
import { runFinanceImport } from '../../../src/jobs/finance-import';
import { seedTwoTenants, TenantFixture } from '../helpers/tenancy';

const IMPORTS = '/api/v1/finance/imports';
const OFX_FIXTURE = join(__dirname, '../fixtures/ofx/bank-sgml-latin1.ofx');
const OFX_CONTENT = readFileSync(OFX_FIXTURE);
const OFX_HASH = createHash('sha256').update(OFX_CONTENT).digest('hex');

/**
 * O `env` é um objeto mutável lido no boot. O teste ajusta os campos
 * financeiros em runtime — o cast evita acoplar o teste ao shape final do
 * `EnvConfig` (que só existe depois da implementação).
 */
interface FinanceEnvOverrides {
  financeMaxOfxMb: number;
  financeMaxPdfMb: number;
  financeFileKey: string;
  financeStorageDriver: string;
  financeStorageLocalPath: string;
  financeImportRateLimitPerHour: number;
}
const financeEnv = env as unknown as FinanceEnvOverrides;

describe('finance import upload (F2.2)', () => {
  let fixture: TenantFixture;
  let bankAccountAId: string;
  let bankAccountBId: string;
  let tokenNoPerm: string;
  let storageRoot: string;

  const upload = (
    token: string,
    opts: { bankAccountId?: string; content?: Buffer; filename?: string; extra?: Record<string, string> } = {}
  ) => {
    const req = request(app)
      .post(IMPORTS)
      .set('Authorization', `Bearer ${token}`)
      .field('bankAccountId', opts.bankAccountId ?? bankAccountAId);
    for (const [key, value] of Object.entries(opts.extra ?? {})) {
      req.field(key, value);
    }
    return req.attach('file', opts.content ?? OFX_CONTENT, opts.filename ?? 'extrato.ofx');
  };

  beforeAll(async () => {
    fixture = await seedTwoTenants();

    const bankA = await prisma.bankAccount.create({
      data: {
        companyId: fixture.companyAId,
        name: `Conta Import A ${fixture.suffix}`,
        initialBalance: 0,
        initialBalanceDate: new Date('2026-11-24T00:00:00.000Z'),
      },
    });
    bankAccountAId = bankA.id;

    const bankB = await prisma.bankAccount.create({
      data: {
        companyId: fixture.companyBId,
        name: `Conta Import B ${fixture.suffix}`,
        initialBalance: 0,
        initialBalanceDate: new Date('2026-11-24T00:00:00.000Z'),
      },
    });
    bankAccountBId = bankB.id;

    // Usuário sem `finance.bank.import` (RBAC).
    const permission = await prisma.permission.upsert({
      where: { name: 'clients.read' },
      update: {},
      create: { name: 'clients.read', description: 'clients.read', module: 'clients' },
    });
    const role = await prisma.role.create({
      data: {
        name: `SemImport-${fixture.suffix}`,
        isSystem: false,
        isActive: true,
        rolePermissions: { create: [{ permissionId: permission.id }] },
      },
    });
    const user = await prisma.user.create({
      data: {
        email: `sem-import-${fixture.suffix}@test.local`,
        passwordHash: await bcrypt.hash('teste123', 4),
        name: 'Sem Import',
        roleId: role.id,
        companyId: fixture.companyAId,
      },
    });
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'teste123' });
    tokenNoPerm = login.body.data.accessToken;

    storageRoot = mkdtempSync(join(tmpdir(), 'finance-import-'));
    financeEnv.financeMaxOfxMb = 10;
    financeEnv.financeMaxPdfMb = 20;
    financeEnv.financeFileKey = 'a'.repeat(64);
    financeEnv.financeStorageDriver = 'LOCAL';
    financeEnv.financeStorageLocalPath = storageRoot;
    financeEnv.financeImportRateLimitPerHour = 20;
  });

  afterAll(() => {
    rmSync(storageRoot, { recursive: true, force: true });
  });

  it('1. arquivo sem assinatura OFX => 415 IMPORT_UNSUPPORTED_FILE', async () => {
    const res = await upload(fixture.tokenA, {
      content: Buffer.from('isto nao e um extrato'),
      filename: 'extrato.txt',
    });
    expect(res.status).toBe(415);
    expect(res.body.status).toBe('error');
    expect(res.body.code).toBe('IMPORT_UNSUPPORTED_FILE');
  });

  it('2. PDF => 415 (parser de PDF chega na Fase 3)', async () => {
    const res = await upload(fixture.tokenA, {
      content: Buffer.from('%PDF-1.4\n% extrato\n'),
      filename: 'fatura.pdf',
    });
    expect(res.status).toBe(415);
    expect(res.body.code).toBe('IMPORT_UNSUPPORTED_FILE');
  });

  it('3. acima do limite => 413 IMPORT_TOO_LARGE', async () => {
    const previous = financeEnv.financeMaxOfxMb;
    financeEnv.financeMaxOfxMb = 0;
    try {
      const res = await upload(fixture.tokenA);
      expect(res.status).toBe(413);
      expect(res.body.code).toBe('IMPORT_TOO_LARGE');
    } finally {
      financeEnv.financeMaxOfxMb = previous;
    }
  });

  it('4. sem chave de criptografia => 503 IMPORT_STORAGE_NOT_CONFIGURED', async () => {
    const previous = financeEnv.financeFileKey;
    financeEnv.financeFileKey = '';
    try {
      const res = await upload(fixture.tokenA);
      expect(res.status).toBe(503);
      expect(res.body.code).toBe('IMPORT_STORAGE_NOT_CONFIGURED');
    } finally {
      financeEnv.financeFileKey = previous;
    }
  });

  it('5. sem a permissão finance.bank.import => 403', async () => {
    const res = await upload(tokenNoPerm);
    expect(res.status).toBe(403);
  });

  it('6. upload válido => 202, lote UPLOADED, hash sha256 e arquivo criptografado', async () => {
    const res = await upload(fixture.tokenA, {
      extra: { companyId: fixture.companyBId, kind: 'BANK_STATEMENT' },
    });

    expect(res.status).toBe(202);
    expect(res.body.status).toBe('success');
    expect(res.body.data.status).toBe('UPLOADED');
    const batchId = res.body.data.batchId;
    expect(typeof batchId).toBe('string');

    const batch = await prisma.importBatch.findUnique({ where: { id: batchId } });
    expect(batch).not.toBeNull();
    // `companyId` do body foi ignorado: a empresa vem do `req.user`.
    expect(batch!.companyId).toBe(fixture.companyAId);
    expect(batch!.bankAccountId).toBe(bankAccountAId);
    expect(batch!.status).toBe('UPLOADED');
    expect(batch!.fileHash).toBe(OFX_HASH);
    expect(batch!.fileSize).toBe(OFX_CONTENT.length);
    expect(batch!.storageKey).toBe(`finance/${fixture.companyAId}/${batchId}.ofx`);

    // Arquivo no disco: existe, cifrado (≠ conteúdo original) e maior (IV+tag).
    const storedPath = join(storageRoot, batch!.storageKey!);
    expect(existsSync(storedPath)).toBe(true);
    const stored = readFileSync(storedPath);
    expect(stored.equals(OFX_CONTENT)).toBe(false);
    expect(stored.length).toBeGreaterThan(OFX_CONTENT.length);
  });

  it('7. mesmo hash já CONFIRMADO => 200 com aviso IMPORT_ALREADY_IMPORTED', async () => {
    const previous = await prisma.importBatch.create({
      data: {
        companyId: fixture.companyAId,
        bankAccountId: bankAccountAId,
        fileName: 'extrato-anterior.ofx',
        fileSize: OFX_CONTENT.length,
        fileHash: OFX_HASH,
        status: 'CONFIRMED',
        uploadedById: fixture.userAId,
        confirmedById: fixture.userAId,
        confirmedAt: new Date(),
      },
    });

    const res = await upload(fixture.tokenA);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.warning.code).toBe('IMPORT_ALREADY_IMPORTED');
    expect(res.body.data.batchId).toBe(previous.id);
    expect(res.body.data.status).toBe('CONFIRMED');
  });

  it('8. rate limit por empresa => 429 IMPORT_RATE_LIMITED', async () => {
    const previous = financeEnv.financeImportRateLimitPerHour;
    financeEnv.financeImportRateLimitPerHour = 1;
    try {
      const first = await upload(fixture.tokenB, { bankAccountId: bankAccountBId });
      expect(first.status).toBe(202);

      const second = await upload(fixture.tokenB, { bankAccountId: bankAccountBId });
      expect(second.status).toBe(429);
      expect(second.body.code).toBe('IMPORT_RATE_LIMITED');
    } finally {
      financeEnv.financeImportRateLimitPerHour = previous;
    }
  });

  it('9. runner processa o lote: linhas em staging, método, dedupe e saldo', async () => {
    // Teste 7 deixou um lote CONFIRMADO com o mesmo hash: `force` é o caminho
    // da spec para reprocessar sem cair no aviso IMPORT_ALREADY_IMPORTED.
    const res = await upload(fixture.tokenA, { extra: { force: 'true' } });
    expect(res.status).toBe(202);
    const batchId = res.body.data.batchId;

    const result = await runFinanceImport(batchId, fixture.companyAId);
    expect(result.totalRows).toBe(3);
    // Σ linhas = -10,50 + 1500,00 - 10,50 = 1479,00; o arquivo declara 1489,50.
    expect(result.balanceCheck).toBe('MISMATCH');
    expect(result.status).toBe('NEEDS_REVIEW');

    const rows = await prisma.importRow.findMany({
      where: { batchId },
      orderBy: { rowIndex: 'asc' },
    });
    expect(rows).toHaveLength(3);
    expect(rows[0].dedupeKey).toBe('F:FIT-0001');
    expect(rows[1].inferredMethod).toBe('PIX');
    expect(rows[1].normalizedDescription).toBe('CLIENTE 01');
    expect(rows[0].isDuplicate).toBe(false);
    expect(rows.every((r) => r.isDuplicate === false)).toBe(true);

    const batch = await prisma.importBatch.findUnique({ where: { id: batchId } });
    expect(batch!.status).toBe('NEEDS_REVIEW');
    expect(batch!.totalRows).toBe(3);
    expect(batch!.newRows).toBe(3);
    expect(batch!.duplicateRows).toBe(0);
    expect(batch!.parserId).toBe('ofx-v1');
    expect(batch!.periodStart?.toISOString().slice(0, 10)).toBe('2026-11-01');
    expect(batch!.periodEnd?.toISOString().slice(0, 10)).toBe('2026-11-30');
    expect(Number(batch!.computedEndBalance)).toBe(1479);
    expect(Number(batch!.statementEndBalance)).toBe(1489.5);
  });

  it('10. GET /imports/:id e /imports/:id/rows devolvem o lote e as linhas', async () => {
    const res = await upload(fixture.tokenA, { extra: { force: 'true' } });
    const batchId = res.body.data.batchId;
    await runFinanceImport(batchId, fixture.companyAId);

    const detail = await request(app)
      .get(`${IMPORTS}/${batchId}`)
      .set('Authorization', `Bearer ${fixture.tokenA}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.id).toBe(batchId);
    expect(detail.body.data.status).toBe('NEEDS_REVIEW');
    expect(detail.body.data.totalRows).toBe(3);
    expect(detail.body.data.balanceCheck).toBe('MISMATCH');
    expect(typeof detail.body.data.computedEndBalance).toBe('number');

    const rows = await request(app)
      .get(`${IMPORTS}/${batchId}/rows`)
      .set('Authorization', `Bearer ${fixture.tokenA}`);
    expect(rows.status).toBe(200);
    expect(rows.body.data).toHaveLength(3);
    expect(rows.body.pagination.total).toBe(3);
    expect(rows.body.data[1].inferredMethod).toBe('PIX');
    expect(rows.body.data[0].amount).toBe(-10.5);
  });

  it('11. lista devolve apenas os lotes da empresa e pagina', async () => {
    const res = await request(app)
      .get(IMPORTS)
      .set('Authorization', `Bearer ${fixture.tokenA}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.pagination).toBeDefined();
    const batches = await prisma.importBatch.findMany({
      where: { companyId: fixture.companyAId },
      select: { id: true },
    });
    expect(res.body.pagination.total).toBe(batches.length);
  });

  it('12. lote de outro tenant => 404', async () => {
    const created = await upload(fixture.tokenA, { extra: { force: 'true' } });
    const batchId = created.body.data.batchId;

    const res = await request(app)
      .get(`${IMPORTS}/${batchId}`)
      .set('Authorization', `Bearer ${fixture.tokenB}`);
    expect(res.status).toBe(404);
  });
});
