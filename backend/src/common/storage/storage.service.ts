import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import * as path from 'path';
import type { Readable } from 'stream';
import type { StorageProvider } from './storage-provider.interface';
import { LocalStorageProvider } from './providers/local-storage.provider';
import { R2StorageProvider } from './providers/r2-storage.provider';
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
      const accountId = this.getRequiredEnv('R2_ACCOUNT_ID');
      const accessKeyId = this.getRequiredEnv('R2_ACCESS_KEY_ID');
      const secretAccessKey = this.getRequiredEnv('R2_SECRET_ACCESS_KEY');
      const bucket = this.getRequiredEnv('R2_BUCKET');
      this.provider = new R2StorageProvider({
        accountId,
        accessKeyId,
        secretAccessKey,
        bucket,
        endpoint: this.config.get<string>('R2_ENDPOINT'),
        region: this.config.get<string>('R2_REGION') || 'auto',
        publicUrl: this.config.get<string>('R2_PUBLIC_URL'),
        keyPrefix: this.config.get<string>('R2_KEY_PREFIX'),
      });
      StorageService.log.log(`Storage driver activo: ${driver} (bucket=${bucket})`);
    } else {
      this.provider = new LocalStorageProvider(basePath);
      StorageService.log.log(
        `Storage driver activo: local (path=${basePath})`,
      );
    }
  }

  private getRequiredEnv(name: string): string {
    const value = this.config.get<string>(name)?.trim();
    if (!value) {
      throw new Error(`Configuración de storage incompleta: falta variable ${name}`);
    }
    return value;
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
