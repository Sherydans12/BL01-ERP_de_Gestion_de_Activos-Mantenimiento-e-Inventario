import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import * as path from 'path';
import type { Readable } from 'stream';
import { PrismaService } from '../../prisma/prisma.service';
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

export type StorageAuditTarget = {
  entityType: 'PURCHASE_DOCUMENT' | 'WORK_ORDER';
  entityId: string;
  storageKey: string;
};

@Injectable()
export class StorageService {
  private static readonly log = new Logger(StorageService.name);
  private readonly provider: StorageProvider;
  private readonly backendPublicUrl: string;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    const driver = (config.get<string>('STORAGE_DRIVER') || 'local').toLowerCase();
    const basePath = config.get<string>('UPLOAD_PATH') || './uploads';
    this.backendPublicUrl =
      config.get<string>('BACKEND_PUBLIC_URL')?.trim().replace(/\/+$/, '') || '';
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

  private looksLikeHttp(value: string): boolean {
    return /^https?:\/\//i.test(value);
  }

  private buildLocalUrl(pathOrUrl: string): string {
    if (!pathOrUrl.startsWith('/')) return pathOrUrl;
    if (!this.backendPublicUrl) return pathOrUrl;
    return `${this.backendPublicUrl}${pathOrUrl}`;
  }

  normalizeStorageKey(input: string): string {
    const raw = (input || '').trim();
    if (!raw) return raw;

    if (raw.startsWith('/uploads/')) {
      return raw.slice('/uploads/'.length);
    }

    if (this.looksLikeHttp(raw)) {
      try {
        const parsed = new URL(raw);
        if (parsed.pathname.startsWith('/uploads/')) {
          return parsed.pathname.slice('/uploads/'.length);
        }
      } catch {
        return raw;
      }
    }

    return raw;
  }

  async getReadOnlyUrl(storageKey: string): Promise<string> {
    const raw = (storageKey || '').trim();
    if (!raw) return raw;

    if (this.looksLikeHttp(raw)) {
      return raw;
    }

    if (raw.startsWith('/uploads/')) {
      return this.buildLocalUrl(raw);
    }

    const normalized = this.normalizeStorageKey(raw);
    if (!normalized) return raw;

    if (this.provider.kind === 'local') {
      return this.buildLocalUrl(`/uploads/${normalized}`);
    }

    return this.getSignedDownloadUrl(normalized, 300);
  }

  async canTenantReadStorageKey(
    tenantId: string,
    storageKeyCandidate: string,
  ): Promise<boolean> {
    const raw = (storageKeyCandidate || '').trim();
    if (!raw) return false;
    const normalized = this.normalizeStorageKey(raw);
    const uploadsVariant = normalized ? `/uploads/${normalized}` : null;

    const [
      userAvatarCount,
      inventoryDocCount,
      purchaseDocCount,
      quotationCount,
      invoiceCount,
      workOrderSignatureCount,
    ] =
      await Promise.all([
        this.prisma.user.count({
          where: {
            tenantId,
            OR: [
              { avatarUrl: raw },
              { avatarUrl: normalized },
              ...(uploadsVariant ? [{ avatarUrl: uploadsVariant }] : []),
            ],
          },
        }),
        this.prisma.inventoryItemAttachment.count({
          where: {
            tenantId,
            storageKey: normalized,
          },
        }),
        this.prisma.purchaseDocument.count({
          where: {
            tenantId,
            storageKey: normalized,
          },
        }),
        this.prisma.purchaseQuotation.count({
          where: {
            tenantId,
            OR: [
              { attachmentUrl: raw },
              { attachmentUrl: normalized },
              ...(uploadsVariant ? [{ attachmentUrl: uploadsVariant }] : []),
            ],
          },
        }),
        this.prisma.purchaseInvoice.count({
          where: {
            tenantId,
            OR: [
              { pdfUrl: raw },
              { pdfUrl: normalized },
              ...(uploadsVariant ? [{ pdfUrl: uploadsVariant }] : []),
            ],
          },
        }),
        this.prisma.workOrder.count({
          where: {
            tenantId,
            OR: [
              { responsibleMechanicSignature: raw },
              { responsibleMechanicSignature: normalized },
              ...(uploadsVariant
                ? [{ responsibleMechanicSignature: uploadsVariant }]
                : []),
              { shiftSupervisorSignature: raw },
              { shiftSupervisorSignature: normalized },
              ...(uploadsVariant ? [{ shiftSupervisorSignature: uploadsVariant }] : []),
            ],
          },
        }),
      ]);

    return (
      userAvatarCount > 0 ||
      inventoryDocCount > 0 ||
      purchaseDocCount > 0 ||
      quotationCount > 0 ||
      invoiceCount > 0 ||
      workOrderSignatureCount > 0
    );
  }

  async resolveAuditTargetForStorageKey(
    tenantId: string,
    storageKeyCandidate: string,
  ): Promise<StorageAuditTarget | null> {
    const raw = (storageKeyCandidate || '').trim();
    if (!raw) return null;
    const normalized = this.normalizeStorageKey(raw);
    const uploadsVariant = normalized ? `/uploads/${normalized}` : null;

    const purchaseDoc = await this.prisma.purchaseDocument.findFirst({
      where: {
        tenantId,
        storageKey: normalized,
      },
      select: { id: true, storageKey: true },
    });
    if (purchaseDoc) {
      return {
        entityType: 'PURCHASE_DOCUMENT',
        entityId: purchaseDoc.id,
        storageKey: purchaseDoc.storageKey,
      };
    }

    const workOrder = await this.prisma.workOrder.findFirst({
      where: {
        tenantId,
        OR: [
          { responsibleMechanicSignature: raw },
          { responsibleMechanicSignature: normalized },
          ...(uploadsVariant ? [{ responsibleMechanicSignature: uploadsVariant }] : []),
          { shiftSupervisorSignature: raw },
          { shiftSupervisorSignature: normalized },
          ...(uploadsVariant ? [{ shiftSupervisorSignature: uploadsVariant }] : []),
        ],
      },
      select: {
        id: true,
        responsibleMechanicSignature: true,
        shiftSupervisorSignature: true,
      },
    });
    if (!workOrder) return null;
    const resolvedKey =
      workOrder.responsibleMechanicSignature === raw ||
      workOrder.responsibleMechanicSignature === normalized ||
      workOrder.responsibleMechanicSignature === uploadsVariant
        ? workOrder.responsibleMechanicSignature
        : workOrder.shiftSupervisorSignature;
    if (!resolvedKey) return null;
    return {
      entityType: 'WORK_ORDER',
      entityId: workOrder.id,
      storageKey: this.normalizeStorageKey(resolvedKey),
    };
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

  async uploadBufferWithKey(
    storageKey: string,
    buffer: Buffer,
    mimeType = 'application/octet-stream',
  ): Promise<string> {
    this.assertFileSize(buffer);
    const normalized = this.normalizeStorageKey(storageKey);
    const { storageKey: uploadedKey } = await this.provider.upload(
      normalized,
      buffer,
      mimeType,
    );
    return uploadedKey;
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
    const normalized = this.normalizeStorageKey(key);
    if (!normalized) return key;
    if (this.provider.kind === 'local') {
      return this.buildLocalUrl(`/uploads/${normalized}`);
    }
    return this.getPublicUrl(normalized);
  }

  async deleteFile(storageKey: string): Promise<void> {
    const normalized = this.normalizeStorageKey(storageKey);
    if (!normalized) return;
    return this.provider.delete(normalized);
  }

  async getFileStream(storageKey: string): Promise<Readable> {
    const normalized = this.normalizeStorageKey(storageKey);
    return this.provider.readStream(normalized);
  }

  get providerKind(): 'local' | 's3_compatible' {
    return this.provider.kind;
  }
}
