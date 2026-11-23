/**
 * [F1.1b] Migração de categorias legadas de Expense.
 *
 * Preenche APENAS `Expense.categoryId` quando há match exato (systemCode,
 * nome exato ou nome normalizado) com uma FinancialCategory EXPENSE ativa
 * da mesma empresa. A coluna textual `Expense.category` NUNCA é alterada —
 * compatibilidade com relatórios legados e rollback trivial.
 *
 * Idempotente: só processa despesas com categoryId nulo. Reexecutar não
 * cria vínculo duplicado nem apaga dados.
 */
import { PrismaClient } from '@prisma/client';

export interface MigrateExpenseCategoriesOptions {
  /** Restringe a migração a estas empresas. Sem valor = todas. */
  companyIds?: string[];
}

export interface MigrateExpenseCategoriesResult {
  scanned: number;
  linked: number;
  alreadyLinked: number;
  noMatch: number;
  preservedCategoryCount: number;
}

/** Comparação de nomes sem caixa nem acentos — ainda exata, sem substring. */
export function normalizeCategoryKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLocaleLowerCase('pt-BR');
}

function scopedWhere(options: MigrateExpenseCategoriesOptions) {
  return options.companyIds ? { companyId: { in: options.companyIds } } : {};
}

export async function migrateExpenseCategories(
  client: PrismaClient,
  options: MigrateExpenseCategoriesOptions = {}
): Promise<MigrateExpenseCategoriesResult> {
  const scope = scopedWhere(options);

  const [pending, alreadyLinked] = await Promise.all([
    client.expense.findMany({
      where: { ...scope, categoryId: null },
      select: { id: true, companyId: true, category: true },
    }),
    client.expense.count({
      where: { ...scope, categoryId: { not: null } },
    }),
  ]);

  const originalCategoryById = new Map(pending.map((e) => [e.id, e.category]));
  const companyIds = [...new Set(pending.map((e) => e.companyId))];

  const catalog = companyIds.length
    ? await client.financialCategory.findMany({
        where: {
          companyId: { in: companyIds },
          kind: 'EXPENSE',
          isActive: true,
        },
        select: { id: true, companyId: true, name: true, systemCode: true },
      })
    : [];

  const bySystemCode = new Map<string, string>();
  const byName = new Map<string, string>();
  const byNormalizedName = new Map<string, string>();

  for (const category of catalog) {
    const prefix = `${category.companyId}\u0000`;
    if (category.systemCode) {
      bySystemCode.set(prefix + category.systemCode.toUpperCase(), category.id);
    }
    byName.set(prefix + category.name, category.id);
    byNormalizedName.set(prefix + normalizeCategoryKey(category.name), category.id);
  }

  let linked = 0;
  let noMatch = 0;

  for (const expense of pending) {
    const prefix = `${expense.companyId}\u0000`;
    const value = expense.category ?? '';
    const categoryId =
      bySystemCode.get(prefix + value.trim().toUpperCase()) ??
      byName.get(prefix + value) ??
      byNormalizedName.get(prefix + normalizeCategoryKey(value));

    if (!categoryId) {
      noMatch++;
      continue;
    }

    await client.expense.update({
      where: { id: expense.id },
      data: { categoryId },
    });
    linked++;
  }

  // Prova de que a coluna legada sobreviveu: relê os registros tocados.
  const after = pending.length
    ? await client.expense.findMany({
        where: { id: { in: pending.map((e) => e.id) } },
        select: { id: true, category: true },
      })
    : [];
  const preservedCategoryCount = after.filter(
    (e) => e.category === originalCategoryById.get(e.id)
  ).length;

  return {
    scanned: pending.length,
    linked,
    alreadyLinked,
    noMatch,
    preservedCategoryCount,
  };
}

function isDirectExecution(): boolean {
  const entry = process.argv[1] || '';
  return /(^|[\\/])migrate-expense-categories\.(ts|js)$/.test(entry);
}

if (isDirectExecution()) {
  const client = new PrismaClient();
  migrateExpenseCategories(client)
    .then((result) => {
      console.log('✅ Migração de categorias legadas concluída.');
      console.log(`   Despesas examinadas: ${result.scanned}`);
      console.log(`   Vinculadas: ${result.linked}`);
      console.log(`   Já vinculadas (intocadas): ${result.alreadyLinked}`);
      console.log(`   Sem correspondência: ${result.noMatch}`);
      console.log(`   Expense.category preservado: ${result.preservedCategoryCount}/${result.scanned}`);
    })
    .catch((error) => {
      console.error('❌ Erro na migração de categorias:', error);
      process.exit(1);
    })
    .finally(async () => {
      await client.$disconnect();
    });
}
