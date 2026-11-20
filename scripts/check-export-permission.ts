import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();

(async () => {
  const perm = await p.permission.findUnique({
    where: { name: 'clients.export' },
    include: { rolePermissions: { include: { role: true } } },
  });

  console.log('permissao:', perm ? perm.name : 'AUSENTE');
  console.log(
    'roles com a permissao:',
    perm ? perm.rolePermissions.map((r) => r.role.name).join(', ') : '-'
  );

  await p.$disconnect();
})();
