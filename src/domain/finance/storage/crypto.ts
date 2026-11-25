/**
 * [F2.1] Criptografia do arquivo importado — spec §7.1 (FINANCEIRO_IMPLEMENTACAO.md:1215).
 *
 * AES-256-GCM. Layout do payload: `IV(12) | tag(16) | ciphertext`.
 * O IV é aleatório por operação (repetir o mesmo IV com a mesma chave
 * vaza a relação entre plaintexts — não é aceitável em arquivo financeiro).
 *
 * A chave vem de `FINANCE_FILE_KEY` (32 bytes em hex ou base64). Sem ela o
 * arquivo não pode ser cifrado nem decifrado (Review Focus #11 do plano F2).
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;

const assertKey = (key: Buffer): void => {
  if (!Buffer.isBuffer(key) || key.length !== KEY_LENGTH) {
    throw new Error(`Chave FINANCE_FILE_KEY inválida: esperado ${KEY_LENGTH} bytes`);
  }
};

/** Converte `FINANCE_FILE_KEY` (hex ou base64) em 32 bytes. */
export function parseFileKey(raw: string): Buffer {
  const value = (raw ?? '').trim();

  if (!value) {
    throw new Error('Chave FINANCE_FILE_KEY ausente: configure uma chave de 32 bytes');
  }

  if (/^[0-9a-f]{64}$/i.test(value)) {
    return Buffer.from(value, 'hex');
  }

  const decoded = Buffer.from(value, 'base64');
  const canonical = decoded.toString('base64').replace(/=+$/, '');
  if (canonical === value.replace(/=+$/, '') && decoded.length === KEY_LENGTH) {
    return decoded;
  }

  throw new Error(
    `Chave FINANCE_FILE_KEY inválida: esperado ${KEY_LENGTH} bytes em hex ou base64`
  );
}

export function encryptBuffer(data: Buffer, key: Buffer): Buffer {
  assertKey(key);

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);

  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
}

export function decryptBuffer(payload: Buffer, key: Buffer): Buffer {
  assertKey(key);

  if (!Buffer.isBuffer(payload) || payload.length < IV_LENGTH + TAG_LENGTH) {
    throw new Error('Payload cifrado inválido: tamanho insuficiente');
  }

  const iv = payload.subarray(0, IV_LENGTH);
  const tag = payload.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = payload.subarray(IV_LENGTH + TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
