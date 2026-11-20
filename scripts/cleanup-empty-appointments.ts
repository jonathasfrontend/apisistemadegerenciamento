/**
 * DELETE aprovado (Jonathas, 2026-11-13/14): 2 agendamentos vazados de QA
 * + notificações/pagamentos vinculados + notificações órfãs remanescentes.
 *
 * USO:
 *   npx tsx scripts/cleanup-empty-appointments.ts --dry-run   # default
 *   npx tsx scripts/cleanup-empty-appointments.ts --apply
 *
 * FK order: notifications → commissions → payments → appointments
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const TARGET_APPOINTMENT_IDS = [
  'b4efce29-29b8-4306-8b6d-a1d7a244366b', // 13/11 22:24 local
  '15858712-5263-4bac-9059-bb959f5a1963', // 16/11 10:00 local
  '7fdd79ee-3189-47f2-92a3-bb87592183cb', // gate Redis fora (2026-11-14)
  '30726ba3-262c-463b-b172-0d783256661c', // diag POST (2026-11-14)
];

const apply = process.argv.includes('--apply');

(async () => {
  const appointments = await prisma.appointment.findMany({
    where: { id: { in: TARGET_APPOINTMENT_IDS } },
    select: {
      id: true,
      status: true,
      startTime: true,
      client: { select: { name: true } },
      _count: { select: { payments: true, notifications: true } },
    },
  });

  const notifications = await prisma.notification.findMany({
    where: {
      OR: [
        { appointmentId: { in: TARGET_APPOINTMENT_IDS } },
        ...TARGET_APPOINTMENT_IDS.map((id) => ({ link: `/appointments/${id}` })),
      ],
    },
    select: { id: true, type: true, link: true, appointmentId: true },
  });

  const payments = await prisma.payment.findMany({
    where: { appointmentId: { in: TARGET_APPOINTMENT_IDS } },
    select: { id: true, status: true, amount: true, _count: { select: { commissions: true } } },
  });

  // Órfãs: link aponta para recurso que não existe mais (produto/agendamento).
  const allLinked = await prisma.notification.findMany({
    where: { link: { not: null } },
    select: { id: true, type: true, link: true, appointmentId: true },
  });
  const orphanCandidates = allLinked.filter((n) => {
    if (!n.link) return false;
    const m = n.link.match(/^\/(appointments|products)\/([0-9a-f-]{36})$/i);
    if (!m) return false;
    return true; // validação real abaixo
  });
  const orphanChecked: typeof orphanCandidates = [];
  for (const n of orphanCandidates) {
    const [, entity, id] = n.link!.match(/^\/(appointments|products)\/([0-9a-f-]{36})$/i)!;
    const exists =
      entity === 'appointments'
        ? await prisma.appointment.findUnique({ where: { id }, select: { id: true } })
        : await prisma.product.findUnique({ where: { id }, select: { id: true } });
    if (!exists) orphanChecked.push(n);
  }
  // Órfãs por appointmentId apagado.
  const orphanByFk = await prisma.notification.findMany({
    where: { appointmentId: { not: null } },
    select: { id: true, type: true, link: true, appointmentId: true },
  });
  const orphanFkChecked: typeof orphanByFk = [];
  for (const n of orphanByFk) {
    const exists = await prisma.appointment.findUnique({
      where: { id: n.appointmentId! },
      select: { id: true },
    });
    if (!exists) orphanFkChecked.push(n);
  }
  const orphans = [...orphanChecked, ...orphanFkChecked].filter(
    (n, i, arr) => arr.findIndex((x) => x.id === n.id) === i
  );

  console.log('PLANO DE LIMPEZA (agendamentos vazados + órfãs)\n');
  console.log(`agendamentos alvo (${appointments.length}/${TARGET_APPOINTMENT_IDS.length}):`);
  for (const a of appointments) {
    console.log(
      `  - ${a.id} | ${a.status} | ${a.startTime.toISOString()} | ${a.client.name} | payments=${a._count.payments} notifications=${a._count.notifications}`
    );
  }
  for (const id of TARGET_APPOINTMENT_IDS) {
    if (!appointments.some((a) => a.id === id)) console.log(`  ! ${id} NÃO ENCONTRADO`);
  }
  console.log(`\nnotifications vinculadas (${notifications.length}):`);
  for (const n of notifications) {
    console.log(`  - ${n.id} | ${n.type} | link=${n.link ?? '-'} | appointmentId=${n.appointmentId ?? '-'}`);
  }
  console.log(`\npayments vinculados (${payments.length}):`);
  for (const p of payments) {
    console.log(`  - ${p.id} | ${p.status} | ${p.amount} | commissions=${p._count.commissions}`);
  }
  console.log(`\nnotificações órfãs (${orphans.length}):`);
  for (const n of orphans) {
    console.log(`  - ${n.id} | ${n.type} | link=${n.link ?? '-'} | appointmentId=${n.appointmentId ?? '-'}`);
  }

  if (!apply) {
    console.log('\nDRY-RUN: nada foi alterado. Use --apply para executar.');
    await prisma.$disconnect();
    return;
  }

  const deletedNotifications = await prisma.notification.deleteMany({
    where: { id: { in: [...notifications, ...orphans].map((n) => n.id) } },
  });

  let deletedCommissions = 0;
  for (const p of payments) {
    const res = await prisma.commission.deleteMany({ where: { paymentId: p.id } });
    deletedCommissions += res.count;
  }

  const deletedPayments = await prisma.payment.deleteMany({
    where: { id: { in: payments.map((p) => p.id) } },
  });

  const deletedAppointments = await prisma.appointment.deleteMany({
    where: { id: { in: TARGET_APPOINTMENT_IDS } },
  });

  console.log(
    `\nAPLICADO: notifications=${deletedNotifications.count} commissions=${deletedCommissions} payments=${deletedPayments.count} appointments=${deletedAppointments.count}`
  );

  await prisma.$disconnect();
})();
