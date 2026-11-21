/**
 * [F0.2 / 0B.1] Backfill de companyId: cria "Empresa padrão" e preenche
 * TODAS as tabelas tenant-scoped que estejam sem empresa.
 *
 * Idempotente: rodar de novo afeta 0 linhas.
 * Guard de segurança: exit 1 se sobrar alguma linha NULL após os updates
 * (a migration NOT NULL só roda depois deste script sair com 0).
 *
 * Uso: npx tsx scripts/backfill-company.ts
 * Env: DATABASE_URL (obrigatório), FINANCE_COMPANY_NAME (opcional, default "Empresa padrão")
 */
import { Prisma, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const COMPANY_NAME = process.env.FINANCE_COMPANY_NAME || 'Empresa padrão';

/** Nomes reais das tabelas (@@map do schema). 4 legadas (F0.2) + 13 novas (0B.1). RBAC fica fora. */
const TENANT_TABLES = [
  'users',
  'refresh_tokens',
  'staff',
  'clients',
  'services',
  'appointments',
  'payments',
  'commissions',
  'expenses',
  'products',
  'stock_movements',
  'sales',
  'sale_items',
  'notifications',
  'reviews',
  'audit_logs',
  'waitlist',
] as const;

async function countNulls(): Promise<Record<string, number>> {
  const entries = await Promise.all(
    TENANT_TABLES.map(async (table) => {
      // Identificador vem de lista fixa acima, nunca de input externo.
      const rows = await prisma.$queryRawUnsafe<{ c: bigint }[]>(
        `SELECT COUNT(*)::bigint AS c FROM "${table}" WHERE "companyId" IS NULL`
      );
      return [table, Number(rows[0].c)] as const;
    })
  );
  return Object.fromEntries(entries);
}

async function main(): Promise<void> {
  const before = await countNulls();
  console.log('[backfill] Nulos ANTES:', JSON.stringify(before));

  // 1. Empresa: reutiliza se já existir com esse nome, senão cria
  let company = await prisma.company.findFirst({ where: { name: COMPANY_NAME } });
  if (!company) {
    company = await prisma.company.create({ data: { name: COMPANY_NAME } });
    console.log(`[backfill] Company criada: ${company.name} (${company.id})`);
  } else {
    console.log(`[backfill] Company existente reutilizada: ${company.name} (${company.id})`);
  }

  // 2. Preenche tudo que está NULL (idempotente).
  // SQL cru: o client gerado já declara companyId NOT NULL e rejeita
  // `where: { companyId: null }`, mesmo com a coluna ainda nullable no DB.
  for (const table of TENANT_TABLES) {
    await prisma.$executeRaw(Prisma.sql`
      UPDATE ${Prisma.raw(`"${table}"`)}
      SET "companyId" = ${company.id}
      WHERE "companyId" IS NULL
    `);
  }
  console.log(`[backfill] Updates IS NULL executados em ${TENANT_TABLES.length} tabelas tenant-scoped.`);

  // 3. Guard: nenhum NULL pode sobrar
  const nulls = await countNulls();
  const total = Object.values(nulls).reduce((a, b) => a + b, 0);
  if (total > 0) {
    console.error(`[backfill] FALHA: ainda existem ${total} linhas sem companyId:`, nulls);
    process.exit(1);
  }
  console.log('[backfill] OK: 0 nulos em todas as tabelas. Migration NOT NULL liberada.');
}

main()
  .catch((err) => {
    console.error('[backfill] Erro:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
