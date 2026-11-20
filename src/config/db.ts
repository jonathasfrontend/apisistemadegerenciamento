import { PrismaClient as PrismaClientType } from '@prisma/client';
import { logger } from '../utils/logger';

const prismaClientSingleton = () => {
  return new PrismaClientType({
    log: process.env.NODE_ENV === 'development' 
      ? ['query', 'error', 'warn'] 
      : ['error'],
  });
};

declare global {
  var prisma: undefined | ReturnType<typeof prismaClientSingleton>;
}

export const prisma = globalThis.prisma ?? prismaClientSingleton();

if (process.env.NODE_ENV !== 'production') {
  globalThis.prisma = prisma;
}

/**
 * Clients criados fora do singleton (services de módulos que instanciam o
 * Prisma localmente) são registrados aqui para que o shutdown feche TODOS os
 * pools — senão o processo fica vivo por causa de conexões abertas.
 */
const extraClients = new Set<PrismaClientType>();

export function createPrismaClient(): PrismaClientType {
  const client = new PrismaClientType();
  extraClients.add(client);
  return client;
}

// Graceful shutdown.
// `once` é obrigatório: com `on`, o $disconnect re-dispara o beforeExit
// e o processo entra em loop infinito de "Disconnecting from database...".
async function disconnectAll(): Promise<void> {
  logger.info('Disconnecting from database...');
  const clients = [prisma, ...extraClients];
  await Promise.all(clients.map((client) => client.$disconnect().catch(() => undefined)));
}

process.once('beforeExit', async () => {
  await disconnectAll();
});

// `beforeExit` NÃO dispara enquanto os sockets do pool Prisma mantêm o event
// loop vivo — os pools escapariam do shutdown. Nos sinais de término
// (deploy, Ctrl+C) o disconnect é explícito e o processo encerra.
for (const signal of ['SIGTERM', 'SIGINT'] as NodeJS.Signals[]) {
  process.once(signal, async () => {
    await disconnectAll();
    process.exit(0);
  });
}

export default prisma;
