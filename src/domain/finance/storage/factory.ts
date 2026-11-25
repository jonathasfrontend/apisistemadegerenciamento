/**
 * [F2.2] Fábrica de storage dos arquivos financeiros — spec §7.1
 * (FINANCEIRO_IMPLEMENTACAO.md:1215-1216).
 *
 * O driver e a chave vêm do ambiente. Sem chave AES ou sem bucket (S3) o
 * storage não pode ser usado: a API responde **503**
 * `IMPORT_STORAGE_NOT_CONFIGURED` em vez de gravar arquivo em claro.
 */
import { resolve } from 'node:path';
import { env } from '../../../config/env';
import { LocalStorage } from './local';
import { S3Storage } from './s3';
import type { FileStorage } from './types';

/** Configuração ausente — a API traduz para 503 IMPORT_STORAGE_NOT_CONFIGURED. */
export class StorageNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageNotConfiguredError';
  }
}

export function createFinanceStorage(): FileStorage {
  if (!env.financeFileKey) {
    throw new StorageNotConfiguredError('FINANCE_FILE_KEY ausente: configure a chave AES-256-GCM');
  }

  if (env.financeStorageDriver === 'S3') {
    if (!env.financeS3Bucket) {
      throw new StorageNotConfiguredError('FINANCE_S3_BUCKET ausente com FINANCE_STORAGE_DRIVER=S3');
    }
    return new S3Storage({
      bucket: env.financeS3Bucket,
      region: env.financeS3Region,
      endpoint: env.financeS3Endpoint || undefined,
      accessKeyId: env.financeS3AccessKey || undefined,
      secretAccessKey: env.financeS3SecretKey || undefined,
    });
  }

  return new LocalStorage(resolve(env.financeStorageLocalPath));
}
