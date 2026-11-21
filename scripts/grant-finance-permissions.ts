/**
 * [F0.3] Seed idempotente das 18 permissões finance.*.
 *
 * Uso: npx tsx scripts/grant-finance-permissions.ts
 *
 * - permission.upsert por nome (não apaga nada);
 * - Admin recebe as 18;
 * - Recepção recebe APENAS finance.cash.operate;
 * - sem deleteMany — seguro para rodar contra o Neon.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const FINANCE_PERMISSIONS = [
  { name: 'finance.dashboard', description: 'Visualizar painel financeiro' },
  { name: 'finance.settings', description: 'Configurar parâmetros financeiros' },
  { name: 'finance.catalog.manage', description: 'Gerenciar catálogo financeiro (categorias e contas)' },
  { name: 'finance.cash.operate', description: 'Operar caixa (abertura, movimentação e fechamento)' },
  { name: 'finance.cash.view-all', description: 'Visualizar todos os turnos de caixa' },
  { name: 'finance.cash.reopen', description: 'Reabrir caixa fechado' },
  { name: 'finance.payables.list', description: 'Visualizar contas a pagar' },
  { name: 'finance.payables.create', description: 'Criar contas a pagar' },
  { name: 'finance.payables.update', description: 'Editar contas a pagar' },
  { name: 'finance.payables.pay', description: 'Registrar pagamento de contas a pagar' },
  { name: 'finance.payables.delete', description: 'Excluir contas a pagar' },
  { name: 'finance.receivables.list', description: 'Visualizar contas a receber' },
  { name: 'finance.bank.import', description: 'Importar extratos bancários (OFX)' },
  { name: 'finance.bank.view', description: 'Visualizar transações bancárias' },
  { name: 'finance.reconcile', description: 'Conciliar transações bancárias' },
  { name: 'finance.rules.manage', description: 'Gerenciar regras de conciliação' },
  { name: 'finance.cards.manage', description: 'Gerenciar faturas de cartão' },
  { name: 'finance.reports', description: 'Visualizar relatórios financeiros' },
] as const;

async function link(roleId: string, permissionId: string): Promise<boolean> {
  const existing = await prisma.rolePermission.findFirst({ where: { roleId, permissionId } });
  if (existing) return false;
  await prisma.rolePermission.create({ data: { roleId, permissionId } });
  return true;
}

async function main(): Promise<void> {
  const admin = await prisma.role.findUnique({ where: { name: 'Admin' } });
  const reception = await prisma.role.findUnique({ where: { name: 'Recepção' } });
  if (!admin || !reception) {
    throw new Error('Roles Admin/Recepção não encontradas — rode o seed base primeiro');
  }

  let created = 0;
  let updated = 0;
  let adminLinks = 0;
  let receptionLinks = 0;

  for (const def of FINANCE_PERMISSIONS) {
    const before = await prisma.permission.findUnique({ where: { name: def.name } });
    const permission = await prisma.permission.upsert({
      where: { name: def.name },
      update: { description: def.description, module: 'finance' },
      create: { name: def.name, description: def.description, module: 'finance' },
    });
    if (before) updated++;
    else created++;

    if (await link(admin.id, permission.id)) adminLinks++;
    if (def.name === 'finance.cash.operate') {
      if (await link(reception.id, permission.id)) receptionLinks++;
    }
  }

  const total = await prisma.permission.count({ where: { module: 'finance' } });
  const receptionFinance = await prisma.rolePermission.count({
    where: { roleId: reception.id, permission: { module: 'finance' } },
  });

  console.log(`[finance-perms] criadas=${created} atualizadas=${updated}`);
  console.log(`[finance-perms] vinculos admin=${adminLinks} recepcao=${receptionLinks}`);
  console.log(`[finance-perms] total module=finance=${total} | recepcao finance=${receptionFinance}`);
  if (total !== FINANCE_PERMISSIONS.length || receptionFinance !== 1) {
    throw new Error('Contagem inconsistente após grant');
  }
}

main()
  .catch((err) => {
    console.error('[finance-perms] FALHA:', err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
