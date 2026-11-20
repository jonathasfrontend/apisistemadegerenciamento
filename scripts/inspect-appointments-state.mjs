// Read-only: appointments no banco (diagnóstico de conflito de slot).
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

(async () => {
  const appointments = await prisma.appointment.findMany({
    select: {
      id: true,
      status: true,
      startTime: true,
      endTime: true,
      staff: { select: { id: true, user: { select: { email: true } } } },
    },
    orderBy: { startTime: 'asc' },
  });

  console.log(JSON.stringify(appointments.map((a) => ({
    id: a.id,
    status: a.status,
    staff: a.staff.user.email,
    staffId: a.staff.id,
    inicio: a.startTime.toISOString(),
    fim: a.endTime.toISOString(),
  })), null, 2));

  await prisma.$disconnect();
})();
