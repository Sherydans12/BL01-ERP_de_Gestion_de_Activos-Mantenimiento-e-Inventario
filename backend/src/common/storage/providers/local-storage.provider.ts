import {
  existsSync,
  mkdirSync,
  writeFileSync,
  unlinkSync,
  createReadStream,
} from 'fs';
import { join, dirname } from 'path';
import type { Readable } from 'stream';
import type { StorageProvider } from '../storage-provider.interface';

/**
 * Almacenamiento en volumen Docker / VPS (`UPLOAD_PATH`, típ. `/uploads`).
 */
export class LocalStorageProvider implements StorageProvider {
  readonly kind = 'local' as const;

  constructor(private readonly basePath: string) {
    if (!existsSync(basePath)) {
      mkdirSync(basePath, { recursive: true });
    }
  }

  upload(
    key: string,
    buffer: Buffer,
    _mimeType: string,
  ): Promise<{ storageKey: string }> {
    const fullPath = join(this.basePath, key);
    const dir = dirname(fullPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(fullPath, buffer);
    return Promise.resolve({ storageKey: key });
  }

  getPublicUrl(storageKey: string): string {
    return `/uploads/${storageKey}`;
  }

  getSignedUrl(storageKey: string, _expiresInSeconds: number): Promise<string> {
    return Promise.resolve(this.getPublicUrl(storageKey));
  }

  delete(storageKey: string): Promise<void> {
    const fullPath = join(this.basePath, storageKey);
    if (existsSync(fullPath)) {
      unlinkSync(fullPath);
    }
    return Promise.resolve();
  }

  readStream(storageKey: string): Promise<Readable> {
    const fullPath = join(this.basePath, storageKey);
    if (!existsSync(fullPath)) {
      const err = new Error(`ENOENT: ${storageKey}`) as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      throw err;
    }
    return Promise.resolve(createReadStream(fullPath));
  }
}
