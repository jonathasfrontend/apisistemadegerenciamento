/**
 * [F2.1] Storage de arquivos financeiros — spec §7.1 (FINANCEIRO_IMPLEMENTACAO.md:1215-1216)
 * e Review Focus #11 do plano F2 (arquivo criptografado em disco).
 *
 * AES-256-GCM: IV aleatório de 12 bytes + tag de 16 bytes + ciphertext.
 * Chave: FINANCE_FILE_KEY em hex (64 chars) ou base64 (32 bytes).
 */
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decryptBuffer, encryptBuffer, parseFileKey } from '../../../src/domain/finance/storage/crypto';
import { LocalStorage } from '../../../src/domain/finance/storage/local';
import { S3Storage } from '../../../src/domain/finance/storage/s3';

const KEY_HEX = 'a'.repeat(64);
const KEY = Buffer.from(KEY_HEX, 'hex');

describe('storage crypto (F2.1)', () => {
  it('aceita chave hex de 32 bytes', () => {
    expect(parseFileKey(KEY_HEX)).toHaveLength(32);
  });

  it('aceita chave base64 de 32 bytes', () => {
    const b64 = Buffer.alloc(32, 7).toString('base64');
    expect(parseFileKey(b64)).toHaveLength(32);
  });

  it('rejeita chave com tamanho inválido', () => {
    expect(() => parseFileKey('abc')).toThrow(/chave/i);
    expect(() => parseFileKey('b'.repeat(128))).toThrow(/chave/i);
  });

  it('rejeita chave hex com caractere inválido', () => {
    expect(() => parseFileKey('z'.repeat(64))).toThrow(/chave/i);
  });

  it('faz round-trip do ciphertext', () => {
    const plain = Buffer.from('conteúdo do extrato OFX', 'utf8');
    const encrypted = encryptBuffer(plain, KEY);
    expect(encrypted).not.toEqual(plain);
    expect(decryptBuffer(encrypted, KEY)).toEqual(plain);
  });

  it('usa IV aleatório (2 cifragens do mesmo conteúdo são diferentes)', () => {
    const plain = Buffer.from('mesmo conteúdo', 'utf8');
    expect(encryptBuffer(plain, KEY)).not.toEqual(encryptBuffer(plain, KEY));
  });

  it('layout do payload: IV(12) + tag(16) + ciphertext', () => {
    const plain = Buffer.from('12345678901234567890', 'utf8');
    const encrypted = encryptBuffer(plain, KEY);
    expect(encrypted).toHaveLength(12 + 16 + plain.length);
  });

  it('falha ao decifrar com a chave errada', () => {
    const encrypted = encryptBuffer(Buffer.from('segredo'), KEY);
    expect(() => decryptBuffer(encrypted, Buffer.alloc(32, 9))).toThrow();
  });

  it('falha ao decifrar payload adulterado', () => {
    const encrypted = encryptBuffer(Buffer.from('segredo'), KEY);
    encrypted[encrypted.length - 1] ^= 0xff;
    expect(() => decryptBuffer(encrypted, KEY)).toThrow();
  });
});

describe('LocalStorage (F2.1)', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'finance-storage-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('grava, lê e apaga o arquivo', async () => {
    const storage = new LocalStorage(root);
    await storage.put('finance/company-1/batch-1.ofx', Buffer.from('OFX-DATA'));

    expect(existsSync(join(root, 'finance/company-1/batch-1.ofx'))).toBe(true);
    expect((await storage.get('finance/company-1/batch-1.ofx')).toString('utf8')).toBe('OFX-DATA');

    await storage.delete('finance/company-1/batch-1.ofx');
    expect(existsSync(join(root, 'finance/company-1/batch-1.ofx'))).toBe(false);
  });

  it('recusa chave com travessia de path', async () => {
    const storage = new LocalStorage(root);
    await expect(storage.put('../evil.ofx', Buffer.from('x'))).rejects.toThrow(/chave|path/i);
  });

  it('propaga erro ao ler arquivo inexistente', async () => {
    const storage = new LocalStorage(root);
    await expect(storage.get('finance/nao-existe.ofx')).rejects.toThrow();
  });
});

describe('S3Storage (F2.1)', () => {
  type Sent = { name: string; input: { Bucket?: string; Key?: string; Body?: unknown } };

  const makeClient = () => {
    const sent: Sent[] = [];
    const client = {
      send: async (command: unknown): Promise<unknown> => {
        const c = command as { constructor: { name: string }; input: Sent['input'] };
        sent.push({ name: c.constructor.name, input: c.input });
        if (c.constructor.name === 'GetObjectCommand') {
          return { Body: { transformToByteArray: async () => new Uint8Array([7, 8, 9]) } };
        }
        return {};
      },
    };
    return { client, sent };
  };

  it('grava no bucket com o prefixo aplicado', async () => {
    const { client, sent } = makeClient();
    const storage = new S3Storage({ bucket: 'finance-bucket', prefix: 'tenant-a', client });

    await storage.put('finance/company-1/batch-1.ofx', Buffer.from('OFX-DATA'));

    expect(sent[0].name).toBe('PutObjectCommand');
    expect(sent[0].input.Bucket).toBe('finance-bucket');
    expect(sent[0].input.Key).toBe('tenant-a/finance/company-1/batch-1.ofx');
    expect(Buffer.from(sent[0].input.Body as Buffer).toString('utf8')).toBe('OFX-DATA');
  });

  it('lê o objeto e devolve bytes', async () => {
    const { client, sent } = makeClient();
    const storage = new S3Storage({ bucket: 'finance-bucket', client });

    const data = await storage.get('finance/company-1/batch-1.ofx');

    expect(sent[0].name).toBe('GetObjectCommand');
    expect(data).toEqual(Buffer.from([7, 8, 9]));
  });

  it('apaga o objeto', async () => {
    const { client, sent } = makeClient();
    const storage = new S3Storage({ bucket: 'finance-bucket', client });

    await storage.delete('finance/company-1/batch-1.ofx');

    expect(sent[0].name).toBe('DeleteObjectCommand');
    expect(sent[0].input.Key).toBe('finance/company-1/batch-1.ofx');
  });

  it('usa o prefixo configurado no objeto', async () => {
    const { client, sent } = makeClient();
    const storage = new S3Storage({ bucket: 'finance-bucket', prefix: 'tenant-a', client });

    await storage.delete('finance/company-1/batch-1.ofx');

    expect(sent[0].input.Key).toBe('tenant-a/finance/company-1/batch-1.ofx');
  });
});
