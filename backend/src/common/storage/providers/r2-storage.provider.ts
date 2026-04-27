import type { Readable } from 'stream';
import { Readable as NodeReadable } from 'stream';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { StorageProvider } from '../storage-provider.interface';

/**
 * Cloudflare R2 (S3 API). Implementar con `@aws-sdk/client-s3` y variables:
 * `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_URL` (opcional).
 *
 * Activación: `STORAGE_DRIVER=r2` (o `s3`) y completar credenciales.
 */
export class R2StorageProvider implements StorageProvider {
  readonly kind = 's3_compatible' as const;
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly endpoint: string;
  private readonly publicUrl: string | null;
  private readonly keyPrefix: string;

  constructor(params: {
    accountId: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucket: string;
    endpoint?: string;
    region?: string;
    publicUrl?: string;
    keyPrefix?: string;
  }) {
    this.bucket = params.bucket;
    this.endpoint =
      params.endpoint?.trim() ||
      `https://${params.accountId.trim()}.r2.cloudflarestorage.com`;
    this.publicUrl = params.publicUrl?.trim() || null;
    this.keyPrefix = (params.keyPrefix || '').trim().replace(/^\/+|\/+$/g, '');

    this.client = new S3Client({
      region: params.region?.trim() || 'auto',
      endpoint: this.endpoint,
      forcePathStyle: true,
      credentials: {
        accessKeyId: params.accessKeyId,
        secretAccessKey: params.secretAccessKey,
      },
    });
  }

  private normalizeKey(storageKey: string): string {
    const clean = storageKey.trim().replace(/^\/+/, '');
    const merged = this.keyPrefix ? `${this.keyPrefix}/${clean}` : clean;
    return merged.replace(/\/{2,}/g, '/');
  }

  async upload(
    key: string,
    buffer: Buffer,
    mimeType: string,
  ): Promise<{ storageKey: string }> {
    const normalizedKey = this.normalizeKey(key);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: normalizedKey,
        Body: buffer,
        ContentType: mimeType || 'application/octet-stream',
      }),
    );
    return { storageKey: normalizedKey };
  }

  getPublicUrl(storageKey: string): string {
    const normalizedKey = this.normalizeKey(storageKey);
    if (this.publicUrl) {
      return `${this.publicUrl.replace(/\/+$/, '')}/${normalizedKey}`;
    }
    return `${this.endpoint}/${this.bucket}/${normalizedKey}`;
  }

  async getSignedUrl(
    storageKey: string,
    expiresInSeconds: number,
  ): Promise<string> {
    const normalizedKey = this.normalizeKey(storageKey);
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: normalizedKey,
      }),
      { expiresIn: expiresInSeconds },
    );
  }

  async delete(storageKey: string): Promise<void> {
    const normalizedKey = this.normalizeKey(storageKey);
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: normalizedKey,
      }),
    );
  }

  async readStream(storageKey: string): Promise<Readable> {
    const normalizedKey = this.normalizeKey(storageKey);
    const output = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: normalizedKey,
      }),
    );
    const body = output.Body;
    if (!body) {
      const err = new Error(`ENOENT: ${normalizedKey}`) as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      throw err;
    }
    if (body instanceof NodeReadable) {
      return body;
    }
    return NodeReadable.from(body as AsyncIterable<Uint8Array>);
  }
}
