/**
 * Limpeza dos dados criados pelo QA browser da fase "notificações expandidas".
 *
 * USO:
 *   npx tsx scripts/cleanup-qa-notificacoes.ts --dry-run   # só mostra o plano (default)
 *   npx tsx scripts/cleanup-qa-notificacoes.ts --apply     # executa o DELETE
 *
 * Alvos (criados pelo browser QA, não pelo seed):
 *   - produto SKU-QA-* (b37a6005-aaaa-49df-b6a6-3f0928e66142)
 *   - agendamento de QA (73717a9f-14a4-4b92-ba18-42222379a8ac)
 *
 * Ordem de delete respeita os FKs:
 *   notifications → commissions → payments → appointments
 *   → stockMovements → products
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const COMPANY_NAME = process.env.FINANCE_COMPANY_NAME || 'Empresa padrão';

/** 0B.1: fail-closed — sem empresa resolvida, nenhum delete roda. */
async function tenantId(): Promise<string> {
  const company = await prisma.company.findFirst({ where: { name: COMPANY_NAME } });
  if (!company) throw new Error(`[cleanup] Empresa "${COMPANY_NAME}" não encontrada — abortando.`);
  return company.id;
}

const QA_PRODUCT_ID = 'b37a6005-aaaa-49df-b6a6-3f0928e66142';
const QA_APPOINTMENT_ID = '73717a9f-14a4-4b92-ba18-42222379a8ac';

const apply = process.argv.includes('--apply');

(async () => {
  const cid = await tenantId();

  const product = await prisma.product.findFirst({
    where: { id: QA_PRODUCT_ID, companyId: cid },
    select: {
      id: true,
      name: true,
      sku: true,
      _count: { select: { stockMovements: true } },
    },
  });

  const appointment = await prisma.appointment.findFirst({
    where: { id: QA_APPOINTMENT_ID, companyId: cid },
    select: {
      id: true,
      status: true,
      startTime: true,
      client: { select: { name: true } },
      _count: { select: { payments: true, notifications: true } },
    },
  });

  // Notificações do QA: as que apontam (link) para o produto/agendamento +
  // as vinculadas por appointmentId.
  const notifications = await prisma.notification.findMany({
    where: {
      companyId: cid,
      OR: [
        { appointmentId: QA_APPOINTMENT_ID },
        { link: `/products/${QA_PRODUCT_ID}` },
        { link: `/appointments/${QA_APPOINTMENT_ID}` },
      ],
    },
    select: { id: true, type: true, link: true, appointmentId: true },
  });

  const payments = await prisma.payment.findMany({
    where: { companyId: cid, appointmentId: QA_APPOINTMENT_ID },
    select: { id: true, status: true, amount: true, _count: { select: { commissions: true } } },
  });

  const stockMovements = await prisma.stockMovement.findMany({
    where: { companyId: cid, productId: QA_PRODUCT_ID },
    select: { id: true, type: true, quantity: true },
  });

  console.log('PLANO DE LIMPEZA\n');
  console.log(
    `produto: ${product ? `${product.name} | sku=${product.sku} | stockMovements=${product._count.stockMovements}` : 'NÃO ENCONTRADO'}`
  );
  console.log(
    `agendamento: ${
      appointment
        ? `${appointment.id} | ${appointment.status} | ${appointment.startTime.toISOString()} | ${appointment.client.name} | payments=${appointment._count.payments} notifications=${appointment._count.notifications}`
        : 'NÃO ENCONTRADO'
    }`
  );
  console.log(`\nnotifications do QA (${notifications.length}):`);
  for (const n of notifications) {
    console.log(`  - ${n.id} | ${n.type} | link=${n.link ?? '-'} | appointmentId=${n.appointmentId ?? '-'}`);
  }
  console.log(`\npayments do QA (${payments.length}):`);
  for (const p of payments) {
    console.log(`  - ${p.id} | ${p.status} | ${p.amount} | commissions=${p._count.commissions}`);
  }
  console.log(`\nstockMovements do produto (${stockMovements.length}):`);
  for (const s of stockMovements) {
    console.log(`  - ${s.id} | ${s.type} | ${s.quantity}`);
  }

  if (!apply) {
    console.log('\nDRY-RUN: nada foi alterado. Use --apply para executar.');
    await prisma.$disconnect();
    return;
  }

  const deletedNotifications = await prisma.notification.deleteMany({
    where: { companyId: cid, id: { in: notifications.map((n) => n.id) } },
  });

  let deletedCommissions = 0;
  for (const p of payments) {
    const res = await prisma.commission.deleteMany({ where: { companyId: cid, paymentId: p.id } });
    deletedCommissions += res.count;
  }

  const deletedPayments = await prisma.payment.deleteMany({
    where: { companyId: cid, id: { in: payments.map((p) => p.id) } },
  });

  const deletedAppointments = await prisma.appointment.deleteMany({
    where: { companyId: cid, id: QA_APPOINTMENT_ID },
  });

  const deletedStockMovements = await prisma.stockMovement.deleteMany({
    where: { companyId: cid, productId: QA_PRODUCT_ID },
  });

  const deletedProducts = await prisma.product.deleteMany({
    where: { companyId: cid, id: QA_PRODUCT_ID },
  });

  console.log(
    `\nAPLICADO: notifications=${deletedNotifications.count} commissions=${deletedCommissions} payments=${deletedPayments.count} appointments=${deletedAppointments.count} stockMovements=${deletedStockMovements.count} products=${deletedProducts.count}`
  );

  await prisma.$disconnect();
})();
