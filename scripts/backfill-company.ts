/**
 * [F0.2] Backfill de companyId: cria "Empresa padrão" e preenche
 * users/payments/expenses/sales que estejam sem empresa.
 *
 * Idempotente: rodar de novo afeta 0 linhas.
 * Guard de seguranca: exit 1 se sobrar alguma linha NULL apos os updates
 * (a migration NOT NULL so roda depois deste script sair com 0).
 *
 * Uso: npx tsx scripts/backfill-company.ts
 * Env: DATABASE_URL (obrigatorio), FINANCE_COMPANY_NAME (opcional, default "Empresa padrão")
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const COMPANY_NAME = process.env.FINANCE_COMPANY_NAME || 'Empresa padrão';

async function countNulls(): Promise<Record<string, number>> {
  const [users, payments, expenses, sales] = await Promise.all([
    prisma.$queryRaw<{ c: bigint }[]>`SELECT COUNT(*)::bigint AS c FROM "users" WHERE "companyId" IS NULL`,
    prisma.$queryRaw<{ c: bigint }[]>`SELECT COUNT(*)::bigint AS c FROM "payments" WHERE "companyId" IS NULL`,
    prisma.$queryRaw<{ c: bigint }[]>`SELECT COUNT(*)::bigint AS c FROM "expenses" WHERE "companyId" IS NULL`,
    prisma.$queryRaw<{ c: bigint }[]>`SELECT COUNT(*)::bigint AS c FROM "sales" WHERE "companyId" IS NULL`,
  ]);
  return {
    users: Number(users[0].c),
    payments: Number(payments[0].c),
    expenses: Number(expenses[0].c),
    sales: Number(sales[0].c),
  };
}

async function main(): Promise<void> {
  const before = await countNulls();
  console.log('[backfill] Nulos ANTES:', JSON.stringify(before));

  // 1. Empresa: reutiliza se ja existir com esse nome, senao cria
  let company = await prisma.company.findFirst({ where: { name: COMPANY_NAME } });
  if (!company) {
    company = await prisma.company.create({ data: { name: COMPANY_NAME } });
    console.log(`[backfill] Company criada: ${company.name} (${company.id})`);
  } else {
    console.log(`[backfill] Company existente reutilizada: ${company.name} (${company.id})`);
  }

  // 2. Preenche tudo que esta NULL (idempotente)
  // SQL cru: o client gerado ja declara companyId como NOT NULL e rejeita
  // `where: { companyId: null }`, mesmo com a coluna ainda nullable no DB.
  await Promise.all([
    prisma.$executeRaw`UPDATE "users" SET "companyId" = ${company.id} WHERE "companyId" IS NULL`,
    prisma.$executeRaw`UPDATE "payments" SET "companyId" = ${company.id} WHERE "companyId" IS NULL`,
    prisma.$executeRaw`UPDATE "expenses" SET "companyId" = ${company.id} WHERE "companyId" IS NULL`,
    prisma.$executeRaw`UPDATE "sales" SET "companyId" = ${company.id} WHERE "companyId" IS NULL`,
  ]);
  console.log(`[backfill] Updates IS NULL executados em users/payments/expenses/sales.`);

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
