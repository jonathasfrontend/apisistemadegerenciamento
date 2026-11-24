/**
 * [F2.0 — cleanup acidental] Remove tenants de teste que foram gravados no
 * Neon por uma execucao de Jest fora do harness (sem DATABASE_URL de teste).
 *
 * Criterio de identificacao (nomes fixos das fixtures de teste):
 *   companies.name ~ /^Tenant [AB] [0-9a-f]{12}$/
 * Tudo que pertence a essas companies e removido (usuarios, clientes, servicos,
 * produtos, pagamentos, despesas, agendamentos, etc.).
 *
 * NAO toca na empresa real ("Empresa padrao") nem em dados sem companyId de teste.
 *
 * Uso:
 *   npx tsx scripts/cleanup-test-tenants.ts --dry-run
 *   npx tsx scripts/cleanup-test-tenants.ts --apply
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const TEST_COMPANY_RE = /^Tenant [AB] ([0-9a-f]{12})$/;
const TEST_ROLE_RE = /^Admin-([0-9a-f]{12})$/;
const TEST_EMAIL_RE = /@test\.local$/;
// Nomes alternativos criados por companies-management.test.ts na MESMA execucao
// (mesmo sufixo hex de 12): identificacao por sufixo, nao por nome exato.
const ALT_TEST_COMPANY_SUFFIX_RE = / [0-9a-f]{12}$/;
const HEX12_RE = /[0-9a-f]{12}/;

async function main() {
  const apply = process.argv.includes('--apply');
  const dryRun = process.argv.includes('--dry-run');
  if (!apply && !dryRun) {
    console.error('Informe --dry-run ou --apply.');
    process.exitCode = 1;
    return;
  }

  const allCompanies = await prisma.company.findMany({
    select: { id: true, name: true },
  });
  const allRoles = await prisma.role.findMany({
    select: { id: true, name: true },
  });
  // Prisma 5.22 nao suporta `regex` em StringFilter: filtra em memoria.
  // Sufixos de execucao = conjunto de hex12 vistos em "Tenant A/B <hex12>".
  const suffixes = new Set<string>();
  for (const c of allCompanies) {
    const m = TEST_COMPANY_RE.exec(c.name);
    if (m) suffixes.add(m[1]);
  }
  // Uma company e de teste se o nome termina no sufixo hex12 de alguma execucao
  // de teste (cobre "Tenant A/B", "Seed-Fora", "Colisao", "Empresa Renomeada", "Empresa TZ UTC").
  const isTestCompany = (name: string) => {
    if (TEST_COMPANY_RE.test(name)) return true;
    const m = ALT_TEST_COMPANY_SUFFIX_RE.exec(name);
    return m ? suffixes.has(m[0].trim()) : false;
  };
  const companies = allCompanies.filter((c) => isTestCompany(c.name));
  const roles = allRoles.filter((r) => TEST_ROLE_RE.test(r.name));
  const companyIds = companies.map((c) => c.id);
  const roleIds = roles.map((r) => r.id);

  console.log(`[cleanup] companies de teste: ${companyIds.length}`);
  console.log(`[cleanup] roles de teste:      ${roleIds.length}`);
  if (companyIds.length === 0) {
    console.log('[cleanup] nada a remover.');
    return;
  }

  // Contagem por tabela tenant-scoped antes de apagar.
  const counts: Record<string, number> = {};
  const inCompanies = { companyId: { in: companyIds } };

  counts.users = await prisma.user.count({ where: { companyId: { in: companyIds } } });
  counts.clients = await prisma.client.count({ where: { companyId: { in: companyIds } } });
  counts.services = await prisma.service.count({ where: { companyId: { in: companyIds } } });
  counts.products = await prisma.product.count({ where: { companyId: { in: companyIds } } });
  counts.staff = await prisma.staff.count({ where: { companyId: { in: companyIds } } });
  counts.appointments = await prisma.appointment.count({ where: { companyId: { in: companyIds } } });
  counts.payments = await prisma.payment.count({ where: { companyId: { in: companyIds } } });
  counts.expenses = await prisma.expense.count({ where: { companyId: { in: companyIds } } });
  counts.sales = await prisma.sale.count({ where: { companyId: { in: companyIds } } });
  counts.notifications = await prisma.notification.count({ where: { companyId: { in: companyIds } } });
  counts.auditLogs = await prisma.auditLog.count({ where: { companyId: { in: companyIds } } });
  counts.waitlist = await prisma.waitlist.count({ where: { companyId: { in: companyIds } } });
  counts.reviews = await prisma.review.count({ where: { companyId: { in: companyIds } } });
  counts.stockMovements = await prisma.stockMovement.count({ where: { companyId: { in: companyIds } } });
  counts.commissions = await prisma.commission.count({ where: { companyId: { in: companyIds } } });
  counts.financeSettings = await prisma.financeSettings.count({ where: { companyId: { in: companyIds } } });
  counts.financialCategories = await prisma.financialCategory.count({ where: { companyId: { in: companyIds } } });
  counts.suppliers = await prisma.supplier.count({ where: { companyId: { in: companyIds } } });
  counts.bankAccounts = await prisma.bankAccount.count({ where: { companyId: { in: companyIds } } });
  counts.acquirers = await prisma.acquirer.count({ where: { companyId: { in: companyIds } } });
  counts.cashRegisters = await prisma.cashRegister.count({ where: { companyId: { in: companyIds } } });
  counts.cashSessions = await prisma.cashSession.count({ where: { companyId: { in: companyIds } } });
  counts.cashMovements = await prisma.cashMovement.count({ where: { companyId: { in: companyIds } } });
  counts.otherIncomes = await prisma.otherIncome.count({ where: { companyId: { in: companyIds } } });
  counts.cardReceivables = await prisma.cardReceivable.count({ where: { companyId: { in: companyIds } } });

  console.log('[cleanup] contagem por tabela:', JSON.stringify(counts));

  // Sanidade: a empresa real nao pode estar na lista.
  // `real` = tudo que NAO casou com o criterio de teste (mesmo criterio da delecao).
  const real = allCompanies.filter((c) => !isTestCompany(c.name));
  const leaked = real.filter((c) => companyIds.includes(c.id));
  if (leaked.length > 0) {
    console.error('[cleanup] ABORT: empresa real entrou na lista.');
    process.exitCode = 1;
    return;
  }
  console.log(`[cleanup] empresas preservadas (${real.length}): ${real.map((c) => c.name).join(', ')}`);

  // Sanidade extra: a empresa real conhecida por nome nunca pode ser deletada.
  const REAL_COMPANY_NAME = 'Empresa padrão';
  if (real.some((c) => c.name !== REAL_COMPANY_NAME)) {
    console.log('[cleanup] AVISO: existem empresas reais adicionais (revisar lista acima).');
  } else {
    console.log('[cleanup] unica empresa real: ' + REAL_COMPANY_NAME + ' (preservada).');
  }

  if (dryRun) {
    console.log('[cleanup] DRY-RUN: nada foi removido.');
    return;
  }

  // Ordem: filhos primeiro (FK RESTRICT).
  await prisma.cashMovement.deleteMany({ where: inCompanies });
  await prisma.cardReceivable.deleteMany({ where: inCompanies });
  await prisma.otherIncome.deleteMany({ where: inCompanies });
  await prisma.cashSession.deleteMany({ where: inCompanies });
  await prisma.cashRegister.deleteMany({ where: inCompanies });
  await prisma.acquirer.deleteMany({ where: inCompanies });
  await prisma.bankAccount.deleteMany({ where: inCompanies });
  await prisma.supplier.deleteMany({ where: inCompanies });
  await prisma.financialCategory.deleteMany({ where: inCompanies });
  await prisma.financeSettings.deleteMany({ where: inCompanies });
  await prisma.commission.deleteMany({ where: inCompanies });
  await prisma.stockMovement.deleteMany({ where: inCompanies });
  await prisma.saleItem.deleteMany({ where: { sale: { companyId: { in: companyIds } } } });
  await prisma.sale.deleteMany({ where: inCompanies });
  await prisma.expense.deleteMany({ where: inCompanies });
  await prisma.payment.deleteMany({ where: inCompanies });
  await prisma.notification.deleteMany({ where: inCompanies });
  await prisma.auditLog.deleteMany({ where: inCompanies });
  await prisma.appointment.deleteMany({ where: inCompanies });
  await prisma.review.deleteMany({ where: inCompanies });
  await prisma.waitlist.deleteMany({ where: inCompanies });
  await prisma.refreshToken.deleteMany({ where: { user: { companyId: { in: companyIds } } } });
  await prisma.staff.deleteMany({ where: inCompanies });
  await prisma.product.deleteMany({ where: inCompanies });
  await prisma.service.deleteMany({ where: inCompanies });
  await prisma.client.deleteMany({ where: inCompanies });
  await prisma.user.deleteMany({ where: { companyId: { in: companyIds } } });
  await prisma.company.deleteMany({ where: { id: { in: companyIds } } });

  // Roles de teste + role_permissions orfas.
  if (roleIds.length > 0) {
    await prisma.rolePermission.deleteMany({ where: { roleId: { in: roleIds } } });
    await prisma.role.deleteMany({ where: { id: { in: roleIds } } });
  }

  // Verificacao final.
  const leftCompanies = (await prisma.company.findMany({ select: { name: true } })).filter((c) =>
    isTestCompany(c.name)
  ).length;
  const leftUsers = (await prisma.user.findMany({ select: { email: true } })).filter((u) =>
    TEST_EMAIL_RE.test(u.email)
  ).length;
  const leftRoles = (await prisma.role.findMany({ select: { name: true } })).filter((r) =>
    TEST_ROLE_RE.test(r.name)
  ).length;
  const companiesAfter = await prisma.company.count();
  const usersAfter = await prisma.user.count();
  const realLeft = (await prisma.company.findMany({ select: { name: true } })).filter(
    (c) => !isTestCompany(c.name)
  );

  console.log('[cleanup] pos: companies=' + companiesAfter + ' users=' + usersAfter);
  console.log(
    '[cleanup] leftovers: companies=' +
      leftCompanies +
      ' users@test.local=' +
      leftUsers +
      ' roles=' +
      leftRoles
  );
  console.log('[cleanup] empresas restantes: ' + realLeft.map((c) => c.name).join(', '));
}

main()
  .catch((e) => {
    console.error('ERR', e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
