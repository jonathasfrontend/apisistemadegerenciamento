import { logger } from '../utils/logger';

/**
 * Redis fora do ar reconecta sozinho; sem limite, cada tentativa gera uma
 * linha de log e o processo vira uma torradeira. Este helper registra o
 * primeiro erro e depois só um a cada `intervalMs`.
 */
export const createThrottledErrorLogger = (
  label: string,
  intervalMs = 10_000
): ((error: any) => void) => {
  let lastLoggedAt = 0;

  return (error: any) => {
    const now = Date.now();
    if (now - lastLoggedAt < intervalMs) return;
    lastLoggedAt = now;
    logger.error(`${label}: ${error?.message ?? error}`);
  };
};

/**
 * Backoff progressivo para o ioredis: 1s, 2s, 3s… até 10s.
 * Sem isso, a reconexão martela o Redis a cada ~50ms.
 */
export const redisRetryStrategy = (times: number): number =>
  Math.min(times * 1000, 10_000);
