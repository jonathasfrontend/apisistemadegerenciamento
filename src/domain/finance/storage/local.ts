/**
 * [F2.1] Storage local de arquivos financeiros — spec §7.1 (FINANCEIRO_IMPLEMENTACAO.md:1215-1216).
 *
 * Chave no formato `finance/{companyId}/{batchId}.{ext}` — o nome original do
 * arquivo nunca entra no caminho. Chaves com travessia de path ou absolutas
 * são recusadas: o storage não pode escrever fora da raiz configurada.
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import type { FileStorage } from './types';

export class LocalStorage implements FileStorage {
  constructor(private readonly root: string) {}

  private resolveKey(key: string): string {
    if (!key || key.trim() === '') {
      throw new Error('Chave de storage vazia');
    }

    const normalizedKey = key.replace(/\\/g, '/');

    if (normalizedKey.startsWith('/') || isAbsolute(key) || /^[a-zA-Z]:/.test(key)) {
      throw new Error(`Chave de storage inválida: "${key}" (path absoluto não permitido)`);
    }

    if (normalizedKey.split('/').some((part) => part === '..')) {
      throw new Error(`Chave de storage inválida: "${key}" (travessia de path não permitida)`);
    }

    const rootResolved = resolve(this.root);
    const full = resolve(join(rootResolved, normalizedKey));

    if (!full.startsWith(rootResolved + sep)) {
      throw new Error(`Chave de storage inválida: "${key}" (fora da raiz do storage)`);
    }

    return full;
  }

  async put(key: string, data: Buffer): Promise<void> {
    const full = this.resolveKey(key);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, data);
  }

  async get(key: string): Promise<Buffer> {
    const full = this.resolveKey(key);
    return readFile(full);
  }

  async delete(key: string): Promise<void> {
    const full = this.resolveKey(key);
    await rm(full, { force: true });
  }
}
