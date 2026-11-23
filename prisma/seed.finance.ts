/**
 * [F1.1b] Seed financeiro idempotente — uma vez por empresa ativa.
 *
 * NUNCA usa deleteMany: o seed clássico (prisma/seed.ts) faz deleteMany global
 * em RBAC e por isso não pode ser reutilizado aqui, muito menos no Neon.
 * Toda escrita é upsert com `update: {}` — reexecutar não apaga nem sobrescreve
 * edições feitas pelo usuário (desativar categoria, ajustar configuração etc).
 */
import { PrismaClient } from '@prisma/client';
import { resolveFinanceWriteTarget } from '../scripts/finance-cli-guard';

export const DEFAULT_CASH_REGISTER_NAME = 'Caixa Principal';

/** Defaults de FinanceSettings conforme a spec (F1.2 / F1.9). */
export const FINANCE_SETTINGS_DEFAULTS = {
  requireOpenCashSession: true,
  cashClosingTolerance: 0,
  matchWindowDays: 3,
  autoConfirmScore: null,
  cardTolerancePct: 1.5,
  fileRetentionDays: 30,
  enableOverdueAlerts: true,
} as const;

export interface DefaultCategory {
  kind: 'INCOME' | 'EXPENSE';
  name: string;
  systemCode?: string;
  sortOrder: number;
}

/**
 * Apêndice C da spec — 21 categorias (5 receitas + 16 despesas).
 * Nota: o plano F1 Task 2 diz "22"; a spec é a fonte de verdade funcional e
 * enumera 21. Divergência registrada no AUDIT (D-F1.5).
 */
export const DEFAULT_CATEGORIES: readonly DefaultCategory[] = [
  // Receitas
  { kind: 'INCOME', name: 'Serviços', sortOrder: 0 },
  { kind: 'INCOME', name: 'Venda de produtos', sortOrder: 1 },
  { kind: 'INCOME', name: 'Pacotes e assinaturas', sortOrder: 2 },
  { kind: 'INCOME', name: 'Outras receitas', sortOrder: 3 },
  { kind: 'INCOME', name: 'Rendimentos financeiros', sortOrder: 4 },
  // Despesas
  { kind: 'EXPENSE', name: 'Aluguel', sortOrder: 0 },
  { kind: 'EXPENSE', name: 'Utilidades (água, luz, internet)', sortOrder: 1 },
  { kind: 'EXPENSE', name: 'Salários e encargos', sortOrder: 2 },
  { kind: 'EXPENSE', name: 'Comissões', sortOrder: 3 },
  { kind: 'EXPENSE', name: 'Produtos e insumos', sortOrder: 4 },
  { kind: 'EXPENSE', name: 'Marketing', sortOrder: 5 },
  { kind: 'EXPENSE', name: 'Impostos e taxas', sortOrder: 6 },
  { kind: 'EXPENSE', name: 'Tarifas bancárias', sortOrder: 7 },
  { kind: 'EXPENSE', name: 'Taxas de maquininha', systemCode: 'CARD_FEES', sortOrder: 8 },
  { kind: 'EXPENSE', name: 'Juros e multas', sortOrder: 9 },
  { kind: 'EXPENSE', name: 'Manutenção', sortOrder: 10 },
  { kind: 'EXPENSE', name: 'Contabilidade', sortOrder: 11 },
  { kind: 'EXPENSE', name: 'Software e assinaturas', sortOrder: 12 },
  { kind: 'EXPENSE', name: 'Pagamento de fatura de cartão', systemCode: 'CARD_INVOICE_PAYMENT', sortOrder: 13 },
  { kind: 'EXPENSE', name: 'Transferência entre contas', systemCode: 'TRANSFER', sortOrder: 14 },
  { kind: 'EXPENSE', name: 'Outras despesas', sortOrder: 15 },
];

export interface FinanceSeedResult {
  companyId: string;
  settingsCreated: boolean;
  registerCreated: boolean;
  categoriesCreated: number;
  /** Nomes padrão já ocupados por categoria de usuário (isSystem=false). */
  collisions: string[];
}

export interface SeedFinanceOptions {
  /** Restringe o seed a estas empresas. Sem valor = todas as ativas. */
  companyIds?: string[];
}

export interface SeedFinanceSummary {
  companies: number;
  settingsCreated: number;
  registersCreated: number;
  categoriesCreated: number;
  collisionCount: number;
  results: FinanceSeedResult[];
}

/**
 * Semeadura de UMA empresa. Seguro para reexecução: `update: {}` preserva
 * qualquer alteração local (config, isActive, cor, ordem).
 */
export async function seedCompanyFinance(
  client: PrismaClient,
  companyId: string
): Promise<FinanceSeedResult> {
  const [settingsBefore, registerBefore, categoriesBefore, existingCategories] =
    await Promise.all([
      client.financeSettings.count({ where: { companyId } }),
      client.cashRegister.count({
        where: { companyId, name: DEFAULT_CASH_REGISTER_NAME },
      }),
      client.financialCategory.count({ where: { companyId, isSystem: true } }),
      client.financialCategory.findMany({
        where: { companyId },
        select: { kind: true, name: true, isSystem: true },
      }),
    ]);

  const occupied = new Set(
    existingCategories
      .filter((category) => !category.isSystem)
      .map((category) => `${category.kind}\u0000${category.name}`)
  );

  await client.financeSettings.upsert({
    where: { companyId },
    update: {},
    create: { companyId, ...FINANCE_SETTINGS_DEFAULTS },
  });

  await client.cashRegister.upsert({
    where: {
      companyId_name: { companyId, name: DEFAULT_CASH_REGISTER_NAME },
    },
    update: {},
    create: { companyId, name: DEFAULT_CASH_REGISTER_NAME, isActive: true },
  });

  const collisions: string[] = [];

  for (const category of DEFAULT_CATEGORIES) {
    if (occupied.has(`${category.kind}\u0000${category.name}`)) {
      collisions.push(category.name);
    }
    await client.financialCategory.upsert({
      where: {
        companyId_kind_name: {
          companyId,
          kind: category.kind,
          name: category.name,
        },
      },
      update: {},
      create: {
        companyId,
        kind: category.kind,
        name: category.name,
        systemCode: category.systemCode ?? null,
        isSystem: true,
        isActive: true,
        sortOrder: category.sortOrder,
      },
    });
  }

  const [settingsAfter, registerAfter, categoriesAfter] = await Promise.all([
    client.financeSettings.count({ where: { companyId } }),
    client.cashRegister.count({
      where: { companyId, name: DEFAULT_CASH_REGISTER_NAME },
    }),
    client.financialCategory.count({ where: { companyId, isSystem: true } }),
  ]);

  return {
    companyId,
    settingsCreated: settingsAfter > settingsBefore,
    registerCreated: registerAfter > registerBefore,
    categoriesCreated: categoriesAfter - categoriesBefore,
    collisions,
  };
}

/** Semeadura de todas as empresas ativas (ou do subconjunto informado). */
export async function seedFinance(
  client: PrismaClient = new PrismaClient(),
  options: SeedFinanceOptions = {}
): Promise<SeedFinanceSummary> {
  const companies = await client.company.findMany({
    where: {
      isActive: true,
      ...(options.companyIds ? { id: { in: options.companyIds } } : {}),
    },
    select: { id: true },
    orderBy: { name: 'asc' },
  });

  const results: FinanceSeedResult[] = [];
  for (const company of companies) {
    results.push(await seedCompanyFinance(client, company.id));
  }

  return {
    companies: results.length,
    settingsCreated: results.reduce((sum, r) => sum + (r.settingsCreated ? 1 : 0), 0),
    registersCreated: results.reduce((sum, r) => sum + (r.registerCreated ? 1 : 0), 0),
    categoriesCreated: results.reduce((sum, r) => sum + r.categoriesCreated, 0),
    collisionCount: results.reduce((sum, r) => sum + r.collisions.length, 0),
    results,
  };
}

function isDirectExecution(): boolean {
  const entry = process.argv[1] || '';
  return /(^|[\\/])seed\.finance\.(ts|js)$/.test(entry);
}

if (isDirectExecution()) {
  const client = new PrismaClient();
  Promise.resolve()
    .then(() =>
      resolveFinanceWriteTarget({
        databaseUrl: process.env.DATABASE_URL,
        command: 'seed:finance',
        argv: process.argv,
      })
    )
    .then((target) =>
      seedFinance(client, { companyIds: target.companyIds }).then((summary) => {
        console.log(`   Host: ${target.hostname}`);
        return summary;
      })
    )
    .then((summary) => {
      console.log('✅ Seed financeiro concluído.');
      console.log(`   Empresas ativas processadas: ${summary.companies}`);
      console.log(`   FinanceSettings criados: ${summary.settingsCreated}`);
      console.log(`   Caixa Principal criado: ${summary.registersCreated}`);
      console.log(`   Categorias padrão criadas: ${summary.categoriesCreated}`);
      if (summary.collisionCount) {
        console.warn(
          `   ⚠️  ${summary.collisionCount} categoria(s) padrão colidiu(ram) com categoria de usuário; nomes preservados.`
        );
      }
    })
    .catch((error) => {
      console.error('❌ Erro no seed financeiro:', error);
      process.exit(1);
    })
    .finally(async () => {
      await client.$disconnect();
    });
}
