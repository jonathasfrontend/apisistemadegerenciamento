// Read-only: confere se sobrou resíduo de QA da fase de notificações expandidas.
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

(async () => {
  const products = await prisma.product.findMany({
    where: { sku: { startsWith: 'SKU-QA-' } },
    select: { id: true, sku: true, name: true },
  });

  const appointment = await prisma.appointment.findUnique({
    where: { id: '73717a9f-14a4-4b92-ba18-42222379a8ac' },
    select: { id: true },
  });

  const notifications = await prisma.notification.findMany({
    where: {
      OR: [
        { link: '/products/b37a6005-aaaa-49df-b6a6-3f0928e66142' },
        { link: '/appointments/73717a9f-14a4-4b92-ba18-42222379a8ac' },
      ],
    },
    select: { id: true, type: true },
  });

  const totals = {
    products: await prisma.product.count(),
    appointments: await prisma.appointment.count(),
    payments: await prisma.payment.count(),
    notifications: await prisma.notification.count(),
  };

  console.log(JSON.stringify({
    residuosProdutosQA: products,
    residuoAgendamentoQA: appointment,
    residuosNotificacoesQA: notifications,
    totais: totals,
  }, null, 2));

  await prisma.$disconnect();
})();
