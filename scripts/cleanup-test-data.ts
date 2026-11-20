/**
 * Limpeza de dados de teste criados pelas validações (browser + scripts).
 *
 * USO:
 *   npx tsx scripts/cleanup-test-data.ts --dry-run   # só mostra o plano (default)
 *   npx tsx scripts/cleanup-test-data.ts --apply     # executa o DELETE
 *
 * Escopo: appointments criados pelos fluxos de teste de notificação (no-show /
 * cancelamento), notificações IN_APP vinculadas a eles e o contador no_show_count
 * dos clientes do seed que foi incrementado por esses mesmos testes.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const TEST_APPOINTMENT_IDS = [
  'a2e86a36-94f5-48e0-9e23-bb47eceecf0f', // NO_SHOW  (script verify-review-fixes)
  'f529203b-bf6a-41d5-9822-ada03e7ea8ba', // CANCELLED (script verify-review-fixes)
  'a0c9f8ec-30c9-4600-957b-668350967b41', // SCHEDULED (1a rodada do script)
  '104629e5-2e52-4fac-b7a8-cc2496adf22c', // SCHEDULED (1a rodada do script)
  '285c4752-3367-4767-af6a-e7b5cdd3915c', // CANCELLED (browser task 3)
  '8cf84c9d-9e6f-44e0-b6fd-ec8f0515d76f', // NO_SHOW  (browser task 3)
  'cc61e836-65d4-4a1f-9532-df3a011899ae', // SCHEDULED (browser task 3)
  '8d32e06e-f4cc-41d0-9cae-8c9879e5d10e', // COMPLETED (browser task 3)
  '0de54981-8365-45ad-9516-f13a598c8bcd', // NO_SHOW (probe de debug)
];

const TEST_CLIENT_COUNTERS = [
  { id: '5304488a-1f63-4869-9027-cd7dec3fba20', name: 'Carla Oliveira' },
  { id: '055223aa-f101-406c-90e3-615294c533e2', name: 'Pedro Almeida' },
  { id: '98eca4bf-6fba-4578-905d-e87f852f2cd9', name: 'Julia Santos' },
];

const apply = process.argv.includes('--apply');

(async () => {
  const appointments = await prisma.appointment.findMany({
    where: { id: { in: TEST_APPOINTMENT_IDS } },
    select: {
      id: true,
      startTime: true,
      status: true,
      client: { select: { name: true } },
      _count: { select: { payments: true, notifications: true } },
    },
    orderBy: { startTime: 'asc' },
  });

  const notifications = await prisma.notification.findMany({
    where: { appointmentId: { in: TEST_APPOINTMENT_IDS } },
    select: { id: true, type: true, appointmentId: true, recipient: true },
  });

  const counters = await prisma.client.findMany({
    where: { id: { in: TEST_CLIENT_COUNTERS.map((c) => c.id) } },
    select: { id: true, name: true, noShowCount: true, isBlocked: true },
  });

  console.log('PLANO DE LIMPEZA\n');
  console.log(`appointments (${appointments.length}):`);
  for (const a of appointments) {
    console.log(
      `  - ${a.id} | ${a.status} | ${a.startTime.toISOString()} | ${a.client.name} | payments=${a._count.payments} notifications=${a._count.notifications}`
    );
  }
  console.log(`\nnotifications vinculadas (${notifications.length}):`);
  for (const n of notifications) {
    console.log(`  - ${n.id} | ${n.type} | ${n.recipient}`);
  }
  console.log('\ncontadores noShowCount (reset para 0):');
  for (const c of counters) {
    console.log(`  - ${c.name} | noShowCount=${c.noShowCount} | isBlocked=${c.isBlocked}`);
  }

  if (!apply) {
    console.log('\nDRY-RUN: nada foi alterado. Use --apply para executar.');
    await prisma.$disconnect();
    return;
  }

  const deletedNotifications = await prisma.notification.deleteMany({
    where: { appointmentId: { in: TEST_APPOINTMENT_IDS } },
  });
  const deletedPayments = await prisma.payment.deleteMany({
    where: { appointmentId: { in: TEST_APPOINTMENT_IDS } },
  });
  const deletedAppointments = await prisma.appointment.deleteMany({
    where: { id: { in: TEST_APPOINTMENT_IDS } },
  });

  for (const c of TEST_CLIENT_COUNTERS) {
    await prisma.client.update({
      where: { id: c.id },
      data: { noShowCount: 0, isBlocked: false },
    });
  }

  console.log(
    `\nAPLICADO: appointments=${deletedAppointments.count} notifications=${deletedNotifications.count} payments=${deletedPayments.count} contadores resetados=${TEST_CLIENT_COUNTERS.length}`
  );

  await prisma.$disconnect();
})();
