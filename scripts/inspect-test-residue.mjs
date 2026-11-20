// Read-only: inventário de resíduos criados pela verificação de review.
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

(async () => {
  const appointments = await prisma.appointment.findMany({
    where: { startTime: { gte: new Date('2026-11-15T00:00:00.000Z') } },
    select: {
      id: true,
      startTime: true,
      status: true,
      notes: true,
      client: { select: { id: true, name: true, noShowCount: true, isBlocked: true } },
    },
    orderBy: { startTime: 'asc' },
  });

  console.log('APPOINTMENTS_FUTUROS/RECENTES:');
  console.log(JSON.stringify(appointments, null, 2));

  const notifications = await prisma.notification.findMany({
    where: { type: { in: ['NO_SHOW', 'CANCELLATION'] } },
    select: { id: true, type: true, channel: true, recipient: true, message: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });

  console.log('\nNOTIFICATIONS_NO_SHOW_CANCEL:');
  console.log(JSON.stringify(notifications, null, 2));

  const clients = await prisma.client.findMany({
    select: { id: true, name: true, noShowCount: true, isBlocked: true },
    orderBy: { noShowCount: 'desc' },
  });

  console.log('\nCLIENTS_COUNTERS:');
  console.log(JSON.stringify(clients, null, 2));

  await prisma.$disconnect();
})();
