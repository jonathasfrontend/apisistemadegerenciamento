import { Prisma, PrismaClient } from '@prisma/client';

type TransactionCapable = Pick<PrismaClient, '$transaction'>;

/**
 * Executa `fn` em transação SERIALIZABLE, repetindo em caso de conflito de
 * escrita (Prisma P2034).
 *
 * Por quê: ler a quantidade do produto e depois decrementar, fora de uma
 * transação serializável, permite que duas saídas concorrentes partam do
 * MESMO estado e gerem dois avisos de "estoque baixo" para uma única
 * travessia do limite. Com SERIALIZABLE + retry, uma das transações aborta
 * e é repetida sobre o estado já atualizado.
 */
export const runSerializable = async <T>(
  client: TransactionCapable,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  retries = 3
): Promise<T> => {
  let attempt = 0;

  for (;;) {
    try {
      return await client.$transaction(fn, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error: any) {
      if (error?.code === 'P2034' && attempt < retries) {
        attempt += 1;
        await new Promise((resolve) => setTimeout(resolve, 20 * attempt));
        continue;
      }
      throw error;
    }
  }
};
