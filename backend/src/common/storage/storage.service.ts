import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import * as path from 'path';
import type { Readable } from 'stream';
import type { StorageProvider } from './storage-provider.interface';
import { LocalStorageProvider } from './providers/local-storage.provider';
import { MAX_UPLOAD_FILE_BYTES } from './file-upload.constants';

export type UploadedFileMeta = {
  storageKey: string;
  publicUrl: string;
  sizeBytes: number;
  mimeType: string;
  originalName: string;
};

@Injectable()
export class StorageService {
  private static readonly log = new Logger(StorageService.name);
  private readonly provider: StorageProvider;

  constructor(private readonly config: ConfigService) {
    const driver = (config.get<string>('STORAGE_DRIVER') || 'local').toLowerCase();
    const basePath = config.get<string>('UPLOAD_PATH') || './uploads';
    if (driver === 'r2' || driver === 's3') {
      StorageService.log.warn(
        `STORAGE_DRIVER=${driver}: R2/S3 aún no está cableado; usando almacenamiento local (${basePath}). ` +
          'Implemente R2StorageProvider y reinicie.',
      );
      this.provider = new LocalStorageProvider(basePath);
    } else {
      this.provider = new LocalStorageProvider(basePath);
    }
  }

  /** Clave con nombre único (UUID) + extensión segura. */
  buildObjectKey(folder: string, originalName: string): string {
    const ext = path.extname(originalName || '') || '';
    const base = path
      .basename(originalName || 'file', ext)
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .slice(0, 120);
    return `${folder}/${randomUUID()}-${base}${ext}`;
  }

  assertFileSize(buffer: Buffer): void {
    if (buffer.length > MAX_UPLOAD_FILE_BYTES) {
      throw new BadRequestException(
        `El archivo supera el máximo de ${MAX_UPLOAD_FILE_BYTES / (1024 * 1024)} MB`,
      );
    }
  }

  /**
   * Subida genérica (inventario, cotizaciones legacy, etc.).
   * Devuelve la clave relativa almacenada en BD (no la URL completa).
   */
  async uploadFile(
    file: { buffer: Buffer; originalname: string; mimetype: string },
    folder: string,
  ): Promise<string> {
    this.assertFileSize(file.buffer);
    const key = this.buildObjectKey(folder, file.originalname);
    const { storageKey } = await this.provider.upload(
      key,
      file.buffer,
      file.mimetype,
    );
    return storageKey;
  }

  async uploadWithMeta(
    file: { buffer: Buffer; originalname: string; mimetype: string },
    folder: string,
  ): Promise<UploadedFileMeta> {
    this.assertFileSize(file.buffer);
    const key = this.buildObjectKey(folder, file.originalname);
    const { storageKey } = await this.provider.upload(
      key,
      file.buffer,
      file.mimetype,
    );
    return {
      storageKey,
      publicUrl: this.getPublicUrl(storageKey),
      sizeBytes: file.buffer.length,
      mimeType: file.mimetype,
      originalName: file.originalname,
    };
  }

  getPublicUrl(storageKey: string): string {
    return this.provider.getPublicUrl(storageKey);
  }

  async getSignedDownloadUrl(
    storageKey: string,
    expiresInSeconds = 3600,
  ): Promise<string> {
    return this.provider.getSignedUrl(storageKey, expiresInSeconds);
  }

  /** @deprecated usar getPublicUrl(storageKey) */
  getFileUrl(key: string): string {
    return this.getPublicUrl(key);
  }

  async deleteFile(storageKey: string): Promise<void> {
    return this.provider.delete(storageKey);
  }

  async getFileStream(storageKey: string): Promise<Readable> {
    return this.provider.readStream(storageKey);
  }

  get providerKind(): 'local' | 's3_compatible' {
    return this.provider.kind;
  }
}
