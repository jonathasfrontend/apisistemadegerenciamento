/**
 * [F1.1b] Seeds financeiros idempotentes + migração de categorias legadas.
 *
 * Roda somente contra o banco de teste (docker-compose.test.yml).
 * Cobertura: 21 categorias do Apêndice C por empresa, 3 systemCodes, defaults
 * de FinanceSettings, "Caixa Principal", idempotência em 2ª execução,
 * preservação de edições do usuário, escopo por empresa na migração de
 * categorias legadas, preservação 100% de Expense.category e invariância
 * de /reports/dashboard (deepEqual) antes/depois da migração.
 */
import request from 'supertest';
import app from '../../../src/app';
import prisma from '../../../src/config/db';
import { seedTwoTenants } from '../helpers/tenancy';
import { seedCompanyFinance, seedFinance } from '../../../prisma/seed.finance';
import { migrateExpenseCategories } from '../../../scripts/migrate-expense-categories';

// Espelha literalmente o Apêndice C da spec — não importa constantes da impl.
const INCOME_NAMES = [
  'Serviços',
  'Venda de produtos',
  'Pacotes e assinaturas',
  'Outras receitas',
  'Rendimentos financeiros',
];

const EXPENSE_NAMES = [
  'Aluguel',
  'Utilidades (água, luz, internet)',
  'Salários e encargos',
  'Comissões',
  'Produtos e insumos',
  'Marketing',
  'Impostos e taxas',
  'Tarifas bancárias',
  'Taxas de maquininha',
  'Juros e multas',
  'Manutenção',
  'Contabilidade',
  'Software e assinaturas',
  'Pagamento de fatura de cartão',
  'Transferência entre contas',
  'Outras despesas',
];

const EXPECTED_SYSTEM_CODES = ['CARD_FEES', 'CARD_INVOICE_PAYMENT', 'TRANSFER'];

describe('finance seed and legacy category migration (finance F1.1b)', () => {
  let fixture: Awaited<ReturnType<typeof seedTwoTenants>>;

  beforeAll(async () => {
    fixture = await seedTwoTenants();
  }, 60_000);

  it('creates FinanceSettings, Caixa Principal and the 21 Appendix C categories', async () => {
    const result = await seedCompanyFinance(prisma, fixture.companyAId);

    expect(result.settingsCreated).toBe(true);
    expect(result.registerCreated).toBe(true);
    expect(result.categoriesCreated).toBe(INCOME_NAMES.length + EXPENSE_NAMES.length);
    expect(result.categoriesCreated).toBe(21);

    const settings = await prisma.financeSettings.findUnique({ where: { companyId: fixture.companyAId } });
    expect(settings).not.toBeNull();
    expect(settings!.requireOpenCashSession).toBe(true);
    expect(Number(settings!.cashClosingTolerance)).toBe(0);
    expect(settings!.matchWindowDays).toBe(3);
    expect(settings!.autoConfirmScore).toBeNull();
    expect(Number(settings!.cardTolerancePct)).toBe(1.5);
    expect(settings!.fileRetentionDays).toBe(30);
    expect(settings!.enableOverdueAlerts).toBe(true);

    const register = await prisma.cashRegister.findUnique({
      where: { companyId_name: { companyId: fixture.companyAId, name: 'Caixa Principal' } },
    });
    expect(register).not.toBeNull();

    const categories = await prisma.financialCategory.findMany({
      where: { companyId: fixture.companyAId },
      orderBy: { name: 'asc' },
    });
    expect(categories).toHaveLength(21);
    expect(categories.every((c) => c.isSystem)).toBe(true);
    expect(categories.filter((c) => c.kind === 'INCOME').map((c) => c.name).sort())
      .toEqual([...INCOME_NAMES].sort());
    expect(categories.filter((c) => c.kind === 'EXPENSE').map((c) => c.name).sort())
      .toEqual([...EXPENSE_NAMES].sort());
    expect(categories.filter((c) => c.systemCode).map((c) => c.systemCode).sort())
      .toEqual(EXPECTED_SYSTEM_CODES);
  }, 60_000);

  it('is idempotent on a second run and never overwrites user edits', async () => {
    await prisma.financeSettings.update({
      where: { companyId: fixture.companyAId },
      data: { matchWindowDays: 99 },
    });
    await prisma.financialCategory.update({
      where: {
        companyId_kind_name: { companyId: fixture.companyAId, kind: 'EXPENSE', name: 'Aluguel' },
      },
      data: { isActive: false },
    });

    const before = await prisma.financialCategory.count({ where: { companyId: fixture.companyAId } });
    const result = await seedCompanyFinance(prisma, fixture.companyAId);
    const after = await prisma.financialCategory.count({ where: { companyId: fixture.companyAId } });

    expect(result.settingsCreated).toBe(false);
    expect(result.registerCreated).toBe(false);
    expect(result.categoriesCreated).toBe(0);
    expect(after).toBe(before);

    const settings = await prisma.financeSettings.findUnique({ where: { companyId: fixture.companyAId } });
    expect(settings!.matchWindowDays).toBe(99);

    const aluguel = await prisma.financialCategory.findUnique({
      where: {
        companyId_kind_name: { companyId: fixture.companyAId, kind: 'EXPENSE', name: 'Aluguel' },
      },
    });
    expect(aluguel!.isActive).toBe(false);
  }, 60_000);

  it('scopes the bulk seed to the requested companies only', async () => {
    const third = await prisma.company.create({ data: { name: `Seed-Fora ${fixture.suffix}` } });

    await seedFinance(prisma, { companyIds: [fixture.companyAId, fixture.companyBId] });

    expect(await prisma.financeSettings.count({ where: { companyId: fixture.companyBId } })).toBe(1);
    expect(await prisma.financialCategory.count({ where: { companyId: fixture.companyBId } })).toBe(21);
    expect(await prisma.financeSettings.count({ where: { companyId: third.id } })).toBe(0);
    expect(await prisma.financialCategory.count({ where: { companyId: third.id } })).toBe(0);
  }, 60_000);

  it('links exact legacy categories, never clears Expense.category and leaves no-match untouched', async () => {
    const suffix = fixture.suffix;
    // 'Aluguel' foi desativado no teste de idempotência; usar categoria ativa.
    const exact = await prisma.expense.create({
      data: {
        companyId: fixture.companyAId,
        description: `Marketing ${suffix}`,
        category: 'Marketing',
        amount: 100,
        dueDate: new Date('2026-11-01T00:00:00.000Z'),
      },
    });
    const byCode = await prisma.expense.create({
      data: {
        companyId: fixture.companyAId,
        description: `Taxa maquininha ${suffix}`,
        category: 'CARD_FEES',
        amount: 10,
        dueDate: new Date('2026-11-01T00:00:00.000Z'),
      },
    });
    const noMatch = await prisma.expense.create({
      data: {
        companyId: fixture.companyAId,
        description: `Categoria invented ${suffix}`,
        category: `INEXISTENTE-${suffix}`,
        amount: 5,
        dueDate: new Date('2026-11-01T00:00:00.000Z'),
      },
    });

    const result = await migrateExpenseCategories(prisma, {
      companyIds: [fixture.companyAId],
    });

    expect(result.linked).toBe(2);
    expect(result.noMatch).toBe(1);
    expect(result.preservedCategoryCount).toBe(3);

    const after = await prisma.expense.findMany({
      where: { id: { in: [exact.id, byCode.id, noMatch.id] } },
      orderBy: { description: 'asc' },
    });
    const byId = new Map(after.map((e) => [e.id, e]));

    expect(byId.get(exact.id)!.category).toBe('Marketing');
    expect(byId.get(exact.id)!.categoryId).not.toBeNull();
    expect(byId.get(byCode.id)!.category).toBe('CARD_FEES');
    expect(byId.get(byCode.id)!.categoryId).not.toBeNull();
    expect(byId.get(noMatch.id)!.category).toBe(`INEXISTENTE-${suffix}`);
    expect(byId.get(noMatch.id)!.categoryId).toBeNull();
  }, 60_000);

  it('keeps /reports/dashboard deep-equal before and after the legacy migration', async () => {
    const suffix = fixture.suffix;
    await prisma.expense.create({
      data: {
        companyId: fixture.companyAId,
        description: `Dashboard ${suffix}`,
        category: 'Aluguel',
        amount: 42,
        dueDate: new Date('2026-11-01T00:00:00.000Z'),
        paidDate: new Date('2026-11-05T00:00:00.000Z'),
        isPaid: true,
      },
    });

    const query =
      '/api/v1/reports/dashboard?startDate=2020-01-01T00:00:00.000Z&endDate=2030-01-01T00:00:00.000Z';
    const before = await request(app).get(query).set('Authorization', `Bearer ${fixture.tokenA}`);
    expect(before.status).toBe(200);

    await migrateExpenseCategories(prisma, { companyIds: [fixture.companyAId] });

    const after = await request(app).get(query).set('Authorization', `Bearer ${fixture.tokenA}`);
    expect(after.status).toBe(200);
    expect(after.body).toEqual(before.body);
    expect(after.body.data.expenses.total).toBeGreaterThan(0);
  }, 60_000);
});
