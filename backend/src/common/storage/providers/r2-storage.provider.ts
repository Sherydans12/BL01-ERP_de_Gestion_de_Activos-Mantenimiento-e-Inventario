import type { Readable } from 'stream';
import type { StorageProvider } from '../storage-provider.interface';

/**
 * Cloudflare R2 (S3 API). Implementar con `@aws-sdk/client-s3` y variables:
 * `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_URL` (opcional).
 *
 * Activación: `STORAGE_DRIVER=r2` (o `s3`) y completar credenciales.
 */
export class R2StorageProvider implements StorageProvider {
  readonly kind = 's3_compatible' as const;

  async upload(
    _key: string,
    _buffer: Buffer,
    _mimeType: string,
  ): Promise<{ storageKey: string }> {
    throw new Error(
      'R2StorageProvider: implementar PutObject con @aws-sdk/client-s3 (endpoint https://<account>.r2.cloudflarestorage.com).',
    );
  }

  getPublicUrl(_storageKey: string): string {
    throw new Error('R2StorageProvider: configurar R2_PUBLIC_URL o dominio custom.');
  }

  async getSignedUrl(
    _storageKey: string,
    _expiresInSeconds: number,
  ): Promise<string> {
    throw new Error('R2StorageProvider: usar GetObjectCommand + getSignedUrl.');
  }

  async delete(_storageKey: string): Promise<void> {
    throw new Error('R2StorageProvider: implementar DeleteObject.');
  }

  async readStream(_storageKey: string): Promise<Readable> {
    throw new Error('R2StorageProvider: implementar GetObject stream.');
  }
}
