// Read-only: appointments no banco + criação simulada no mesmo slot do script.
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

(async () => {
  const appointments = await prisma.appointment.findMany({
    select: { id: true, startTime: true, endTime: true, status: true },
    orderBy: { startTime: 'asc' },
  });

  console.log('APPOINTMENTS NO BANCO:');
  for (const a of appointments) {
    console.log(`  ${a.startTime.toISOString()} -> ${a.endTime.toISOString()} | ${a.status} | ${a.id}`);
  }

  console.log('\nCLIENTES:');
  const clients = await prisma.client.findMany({
    select: { id: true, name: true, noShowCount: true, isBlocked: true },
  });
  for (const c of clients) {
    console.log(`  ${c.name} | noShow=${c.noShowCount} blocked=${c.isBlocked} | ${c.id}`);
  }

  await prisma.$disconnect();
})();
