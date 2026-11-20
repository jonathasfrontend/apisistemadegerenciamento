// Read-only: quebra-down das notificações restantes por tipo/mensagem.
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

(async () => {
  const byType = await prisma.notification.groupBy({
    by: ['type'],
    _count: { _all: true },
    orderBy: { _count: { type: 'desc' } },
  });

  const sample = await prisma.notification.findMany({
    select: { type: true, message: true, createdAt: true, link: true },
    orderBy: { createdAt: 'desc' },
    take: 12,
  });

  console.log(JSON.stringify({
    porTipo: byType.map((t) => ({ tipo: t.type, total: t._count._all })),
    amostraRecente: sample.map((n) => ({
      tipo: n.type,
      mensagem: n.message.slice(0, 70),
      link: n.link ?? '-',
      criadoEm: n.createdAt.toISOString(),
    })),
  }, null, 2));

  await prisma.$disconnect();
})();
