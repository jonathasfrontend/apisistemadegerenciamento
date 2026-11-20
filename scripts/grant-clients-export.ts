/**
 * Aplica a permissão `clients.export` (exportação de clientes em CSV).
 *
 * Idempotente: cria a permissão se faltar, garante que apenas a role
 * Admin a possua e remove de qualquer outra role.
 *
 * Uso: npx tsx scripts/grant-clients-export.ts
 */
import prisma from '../src/config/db';

async function main() {
  const permission = await prisma.permission.upsert({
    where: { name: 'clients.export' },
    update: {},
    create: {
      name: 'clients.export',
      description: 'Exportar dados de clientes (CSV)',
      module: 'clients',
    },
  });

  const roles = await prisma.role.findMany({
    include: { rolePermissions: true },
  });

  const admin = roles.find((r) => r.name === 'Admin');
  if (!admin) {
    throw new Error('Role Admin não encontrada — rode o seed primeiro');
  }

  const adminHas = admin.rolePermissions.some((rp) => rp.permissionId === permission.id);
  if (!adminHas) {
    await prisma.rolePermission.create({
      data: { roleId: admin.id, permissionId: permission.id },
    });
  }
  console.log(`clients.export | Admin: ${adminHas ? 'já possuía' : 'atribuída agora'}`);

  for (const role of roles.filter((r) => r.name !== 'Admin')) {
    const link = role.rolePermissions.find((rp) => rp.permissionId === permission.id);
    if (link) {
      await prisma.rolePermission.delete({ where: { id: link.id } });
      console.log(`clients.export | removida de ${role.name}`);
    }
  }

  const total = await prisma.rolePermission.count({
    where: { permissionId: permission.id },
  });
  console.log(`clientes.export atribuída a ${total} role(s)`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
