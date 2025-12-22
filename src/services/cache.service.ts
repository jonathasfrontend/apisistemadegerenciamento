import IORedis from 'ioredis';
import { env } from '../config/env';
import { logger } from '../utils/logger';

class CacheService {
  private redis: IORedis;
  private readonly DEFAULT_TTL = 3600; // 1 hora em segundos

  constructor() {
    this.redis = new IORedis(env.redisUrl, {
      maxRetriesPerRequest: null,
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
    });

    this.redis.on('connect', () => {
      logger.info('✓ Redis cache connected');
    });

    this.redis.on('error', (err) => {
      logger.error('Redis cache error:', err);
    });
  }

  /**
   * Buscar valor do cache
   */
  async get<T>(key: string): Promise<T | null> {
    try {
      const cached = await this.redis.get(key);
      if (!cached) return null;
      
      return JSON.parse(cached) as T;
    } catch (error) {
      logger.error(`Cache get error for key ${key}:`, error);
      return null;
    }
  }

  /**
   * Salvar valor no cache
   */
  async set(key: string, value: any, ttl: number = this.DEFAULT_TTL): Promise<void> {
    try {
      await this.redis.set(key, JSON.stringify(value), 'EX', ttl);
    } catch (error) {
      logger.error(`Cache set error for key ${key}:`, error);
    }
  }

  /**
   * Deletar chave do cache
   */
  async del(key: string): Promise<void> {
    try {
      await this.redis.del(key);
    } catch (error) {
      logger.error(`Cache delete error for key ${key}:`, error);
    }
  }

  /**
   * Deletar múltiplas chaves por padrão
   */
  async delPattern(pattern: string): Promise<void> {
    try {
      const keys = await this.redis.keys(pattern);
      if (keys.length > 0) {
        await this.redis.del(...keys);
        logger.info(`Deleted ${keys.length} cache keys matching ${pattern}`);
      }
    } catch (error) {
      logger.error(`Cache delete pattern error for ${pattern}:`, error);
    }
  }

  /**
   * Buscar ou executar (cache-aside pattern)
   */
  async getOrSet<T>(
    key: string,
    fetchFn: () => Promise<T>,
    ttl: number = this.DEFAULT_TTL
  ): Promise<T> {
    try {
      // Tentar buscar do cache
      const cached = await this.get<T>(key);
      if (cached !== null) {
        logger.debug(`Cache hit: ${key}`);
        return cached;
      }

      // Cache miss - buscar do banco
      logger.debug(`Cache miss: ${key}`);
      const data = await fetchFn();
      
      // Salvar no cache
      await this.set(key, data, ttl);
      
      return data;
    } catch (error) {
      logger.error(`Cache getOrSet error for key ${key}:`, error);
      // Em caso de erro, executar fetchFn diretamente
      return await fetchFn();
    }
  }

  /**
   * Invalidar cache relacionado a uma entidade
   */
  async invalidateEntity(entity: string, id?: string): Promise<void> {
    if (id) {
      await this.delPattern(`${entity}:${id}*`);
    } else {
      await this.delPattern(`${entity}:*`);
    }
  }

  /**
   * Verificar se o Redis está conectado
   */
  async isConnected(): Promise<boolean> {
    try {
      await this.redis.ping();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Desconectar do Redis
   */
  async disconnect(): Promise<void> {
    await this.redis.quit();
    logger.info('Redis cache disconnected');
  }
}

export const cacheService = new CacheService();
