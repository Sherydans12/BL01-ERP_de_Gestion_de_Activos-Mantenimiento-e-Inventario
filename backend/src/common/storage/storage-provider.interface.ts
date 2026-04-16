import type { Readable } from 'stream';

/**
 * Contrato cloud-ready: local (VPS) o S3-compatible (Cloudflare R2, MinIO, AWS S3).
 * La app usa solo `StorageService`, nunca `fs` directamente.
 */
export interface StorageProvider {
  /** Sube bytes y devuelve la clave relativa (ej. `purchase-docs/uuid.pdf`). */
  upload(
    key: string,
    buffer: Buffer,
    mimeType: string,
  ): Promise<{ storageKey: string }>;

  /** URL pública o prefijo de descarga (local: `/uploads/...`). */
  getPublicUrl(storageKey: string): string;

  /** URL firmada temporal; en local puede coincidir con getPublicUrl si el archivo se sirve con auth por API. */
  getSignedUrl(storageKey: string, expiresInSeconds: number): Promise<string>;

  delete(storageKey: string): Promise<void>;

  readStream(storageKey: string): Promise<Readable>;

  /** Raíz física o bucket (solo diagnóstico / local). */
  readonly kind: 'local' | 's3_compatible';
}
