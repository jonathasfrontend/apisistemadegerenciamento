/**
 * [F2.1] Storage S3 de arquivos financeiros — spec §7.1 (FINANCEIRO_IMPLEMENTACAO.md:1215-1216).
 *
 * O client do AWS SDK é carregado sob demanda (lazy import): quem usa o
 * storage local não paga o carregamento do SDK, e o pacote continua opcional
 * em ambientes sem S3 configurado.
 */
import type { FileStorage } from './types';

/** Client mínimo — permite injetar um fake nos testes. */
export interface S3ClientLike {
  send(command: unknown): Promise<unknown>;
}

export interface S3StorageOptions {
  bucket: string;
  region?: string;
  /** Endpoint customizado (MinIO, R2, LocalStack…). */
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle?: boolean;
  /** Namespace aplicado antes da chave (ex.: tenant, ambiente). */
  prefix?: string;
  /** Client pronto (testes). Quando ausente, é criado sob demanda. */
  client?: S3ClientLike;
}

export class S3Storage implements FileStorage {
  private clientPromise?: Promise<S3ClientLike>;

  constructor(private readonly opts: S3StorageOptions) {}

  private objectKey(key: string): string {
    if (!key || key.trim() === '') {
      throw new Error('Chave de storage vazia');
    }
    const prefix = this.opts.prefix?.replace(/^\/+|\/+$/g, '');
    return prefix ? `${prefix}/${key.replace(/^\/+/, '')}` : key;
  }

  private async client(): Promise<S3ClientLike> {
    if (this.opts.client) return this.opts.client;
    if (!this.clientPromise) {
      this.clientPromise = (async () => {
        const { S3Client } = await import('@aws-sdk/client-s3');
        const credentials =
          this.opts.accessKeyId && this.opts.secretAccessKey
            ? {
                accessKeyId: this.opts.accessKeyId,
                secretAccessKey: this.opts.secretAccessKey,
              }
            : undefined;

        return new S3Client({
          region: this.opts.region ?? 'us-east-1',
          ...(this.opts.endpoint
            ? { endpoint: this.opts.endpoint, forcePathStyle: this.opts.forcePathStyle ?? true }
            : {}),
          ...(credentials ? { credentials } : {}),
        }) as unknown as S3ClientLike;
      })();
    }
    return this.clientPromise;
  }

  async put(key: string, data: Buffer): Promise<void> {
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    const client = await this.client();
    await client.send(
      new PutObjectCommand({
        Bucket: this.opts.bucket,
        Key: this.objectKey(key),
        Body: data,
      })
    );
  }

  async get(key: string): Promise<Buffer> {
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    const client = await this.client();
    const response = (await client.send(
      new GetObjectCommand({ Bucket: this.opts.bucket, Key: this.objectKey(key) })
    )) as { Body?: { transformToByteArray(): Promise<Uint8Array> } } | undefined;

    if (!response?.Body) {
      throw new Error(`Arquivo não encontrado no storage: ${this.objectKey(key)}`);
    }

    return Buffer.from(await response.Body.transformToByteArray());
  }

  async delete(key: string): Promise<void> {
    const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
    const client = await this.client();
    await client.send(
      new DeleteObjectCommand({ Bucket: this.opts.bucket, Key: this.objectKey(key) })
    );
  }
}
