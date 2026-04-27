import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from './storage.service';
import { promises as fs } from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';

const BATCH_SIZE = 50;

type MigrationSummary = {
  migrated: number;
  errors: number;
  alreadyInR2: number;
};

@Injectable()
export class StorageMigrationService {
  private readonly logger = new Logger(StorageMigrationService.name);
  private readonly uploadPath: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly config: ConfigService,
  ) {
    const configured = this.config.get<string>('UPLOAD_PATH') || './uploads';
    this.uploadPath = path.isAbsolute(configured)
      ? configured
      : path.resolve(process.cwd(), configured);
  }

  private toDeterministicUuid(seed: string): string {
    const hex = createHash('sha1').update(seed).digest('hex').slice(0, 32);
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
  }

  private normalizeLegacyUploadsPath(value: string): string | null {
    const s = (value || '').trim();
    if (!s.startsWith('/uploads/')) return null;
    return s.slice('/uploads/'.length);
  }

  private buildR2Key(params: {
    tenantId: string;
    moduleName: string;
    createdAt: Date;
    legacyPath: string;
  }): string {
    const year = params.createdAt.getUTCFullYear().toString();
    const month = String(params.createdAt.getUTCMonth() + 1).padStart(2, '0');
    const ext = path.extname(params.legacyPath || '').toLowerCase();
    const deterministicUuid = this.toDeterministicUuid(
      `${params.tenantId}|${params.moduleName}|${params.legacyPath}`,
    );
    return `tenants/${params.tenantId}/${params.moduleName}/${year}/${month}/${deterministicUuid}${ext}`;
  }

  private guessMimeType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
    if (ext === '.png') return 'image/png';
    if (ext === '.webp') return 'image/webp';
    if (ext === '.gif') return 'image/gif';
    if (ext === '.pdf') return 'application/pdf';
    if (ext === '.svg') return 'image/svg+xml';
    if (ext === '.txt') return 'text/plain';
    return 'application/octet-stream';
  }

  private async migrateOneRecord(params: {
    tableLabel: string;
    tenantId: string;
    moduleName: string;
    createdAt: Date;
    legacyValue: string;
    mimeType?: string | null;
    updateDb: (newStorageKey: string) => Promise<void>;
  }): Promise<'migrated' | 'error'> {
    const legacyRelativePath = this.normalizeLegacyUploadsPath(params.legacyValue);
    if (!legacyRelativePath) {
      return 'error';
    }

    const absolutePath = path.join(this.uploadPath, legacyRelativePath);
    const targetKey = this.buildR2Key({
      tenantId: params.tenantId,
      moduleName: params.moduleName,
      createdAt: params.createdAt,
      legacyPath: legacyRelativePath,
    });

    try {
      const buffer = await fs.readFile(absolutePath);
      const mimeType = params.mimeType?.trim() || this.guessMimeType(absolutePath);
      await this.storage.uploadBufferWithKey(targetKey, buffer, mimeType);
      await params.updateDb(targetKey);
      return 'migrated';
    } catch (error) {
      this.logger.error(
        `[${params.tableLabel}] fallo migración (${params.legacyValue}) -> ${targetKey}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return 'error';
    }
  }

  private async migrateUsers(summary: MigrationSummary): Promise<void> {
    let cursorId: string | null = null;
    while (true) {
      const rows: Array<{
        id: string;
        tenantId: string | null;
        avatarUrl: string | null;
        createdAt: Date;
      }> = await this.prisma.user.findMany({
        where: {
          avatarUrl: { startsWith: '/uploads/' },
          ...(cursorId ? { id: { gt: cursorId } } : {}),
        },
        orderBy: { id: 'asc' },
        take: BATCH_SIZE,
        select: { id: true, tenantId: true, avatarUrl: true, createdAt: true },
      });
      if (!rows.length) break;
      cursorId = rows[rows.length - 1]!.id;

      for (const row of rows) {
        if (!row.avatarUrl || !row.tenantId) {
          summary.errors += 1;
          continue;
        }
        const result = await this.migrateOneRecord({
          tableLabel: 'User.avatarUrl',
          tenantId: row.tenantId,
          moduleName: 'users',
          createdAt: row.createdAt,
          legacyValue: row.avatarUrl,
          updateDb: (newStorageKey) =>
            this.prisma.user.update({
              where: { id: row.id },
              data: { avatarUrl: newStorageKey },
            }).then(() => undefined),
        });
        if (result === 'migrated') summary.migrated += 1;
        else summary.errors += 1;
      }
    }
  }

  private async migrateInventoryAttachments(summary: MigrationSummary): Promise<void> {
    let cursorId: string | null = null;
    while (true) {
      const rows: Array<{
        id: string;
        tenantId: string;
        storageKey: string;
        mimeType: string;
        createdAt: Date;
      }> = await this.prisma.inventoryItemAttachment.findMany({
        where: {
          storageKey: { startsWith: '/uploads/' },
          ...(cursorId ? { id: { gt: cursorId } } : {}),
        },
        orderBy: { id: 'asc' },
        take: BATCH_SIZE,
        select: {
          id: true,
          tenantId: true,
          storageKey: true,
          mimeType: true,
          createdAt: true,
        },
      });
      if (!rows.length) break;
      cursorId = rows[rows.length - 1]!.id;

      for (const row of rows) {
        const result = await this.migrateOneRecord({
          tableLabel: 'InventoryItemAttachment.storageKey',
          tenantId: row.tenantId,
          moduleName: 'inventory',
          createdAt: row.createdAt,
          legacyValue: row.storageKey,
          mimeType: row.mimeType,
          updateDb: (newStorageKey) =>
            this.prisma.inventoryItemAttachment.update({
              where: { id: row.id },
              data: { storageKey: newStorageKey },
            }).then(() => undefined),
        });
        if (result === 'migrated') summary.migrated += 1;
        else summary.errors += 1;
      }
    }
  }

  private async migratePurchaseDocuments(summary: MigrationSummary): Promise<void> {
    let cursorId: string | null = null;
    while (true) {
      const rows: Array<{
        id: string;
        tenantId: string;
        storageKey: string;
        mimeType: string;
        createdAt: Date;
      }> = await this.prisma.purchaseDocument.findMany({
        where: {
          storageKey: { startsWith: '/uploads/' },
          ...(cursorId ? { id: { gt: cursorId } } : {}),
        },
        orderBy: { id: 'asc' },
        take: BATCH_SIZE,
        select: {
          id: true,
          tenantId: true,
          storageKey: true,
          mimeType: true,
          createdAt: true,
        },
      });
      if (!rows.length) break;
      cursorId = rows[rows.length - 1]!.id;

      for (const row of rows) {
        const result = await this.migrateOneRecord({
          tableLabel: 'PurchaseDocument.storageKey',
          tenantId: row.tenantId,
          moduleName: 'purchases',
          createdAt: row.createdAt,
          legacyValue: row.storageKey,
          mimeType: row.mimeType,
          updateDb: (newStorageKey) =>
            this.prisma.purchaseDocument.update({
              where: { id: row.id },
              data: { storageKey: newStorageKey },
            }).then(() => undefined),
        });
        if (result === 'migrated') summary.migrated += 1;
        else summary.errors += 1;
      }
    }
  }

  private async migrateWorkOrderSignatureField(
    summary: MigrationSummary,
    field: 'responsibleMechanicSignature' | 'shiftSupervisorSignature',
  ): Promise<void> {
    let cursorId: string | null = null;
    while (true) {
      const rows: Array<{
        id: string;
        tenantId: string;
        createdAt: Date;
        responsibleMechanicSignature: string | null;
        shiftSupervisorSignature: string | null;
      }> = await this.prisma.workOrder.findMany({
        where: {
          [field]: { startsWith: '/uploads/' },
          ...(cursorId ? { id: { gt: cursorId } } : {}),
        },
        orderBy: { id: 'asc' },
        take: BATCH_SIZE,
        select: {
          id: true,
          tenantId: true,
          createdAt: true,
          responsibleMechanicSignature: true,
          shiftSupervisorSignature: true,
        },
      });
      if (!rows.length) break;
      cursorId = rows[rows.length - 1]!.id;

      for (const row of rows) {
        const currentValue = row[field];
        if (!currentValue) {
          summary.errors += 1;
          continue;
        }
        const result = await this.migrateOneRecord({
          tableLabel: `WorkOrder.${field}`,
          tenantId: row.tenantId,
          moduleName: 'work-orders',
          createdAt: row.createdAt,
          legacyValue: currentValue,
          updateDb: (newStorageKey) =>
            this.prisma.workOrder.update({
              where: { id: row.id },
              data: { [field]: newStorageKey },
            }).then(() => undefined),
        });
        if (result === 'migrated') summary.migrated += 1;
        else summary.errors += 1;
      }
    }
  }

  private async countAlreadyMigrated(): Promise<number> {
    const [
      usersCount,
      inventoryCount,
      purchaseCount,
      workOrderResponsibleCount,
      workOrderSupervisorCount,
    ] = await Promise.all([
      this.prisma.user.count({
        where: {
          avatarUrl: { not: null },
          NOT: { avatarUrl: { startsWith: '/uploads/' } },
        },
      }),
      this.prisma.inventoryItemAttachment.count({
        where: {
          storageKey: { not: { startsWith: '/uploads/' } },
        },
      }),
      this.prisma.purchaseDocument.count({
        where: {
          storageKey: { not: { startsWith: '/uploads/' } },
        },
      }),
      this.prisma.workOrder.count({
        where: {
          responsibleMechanicSignature: { not: null },
          NOT: { responsibleMechanicSignature: { startsWith: '/uploads/' } },
        },
      }),
      this.prisma.workOrder.count({
        where: {
          shiftSupervisorSignature: { not: null },
          NOT: { shiftSupervisorSignature: { startsWith: '/uploads/' } },
        },
      }),
    ]);
    return (
      usersCount +
      inventoryCount +
      purchaseCount +
      workOrderResponsibleCount +
      workOrderSupervisorCount
    );
  }

  async run(): Promise<MigrationSummary> {
    if (this.storage.providerKind !== 's3_compatible') {
      throw new Error(
        'StorageMigrationService requiere STORAGE_DRIVER=r2/s3 para ejecutar migración.',
      );
    }

    this.logger.log('Iniciando migración de archivos locales (/uploads/) hacia R2...');
    this.logger.log(`UPLOAD_PATH origen: ${this.uploadPath}`);
    this.logger.log(`Procesamiento por lotes de ${BATCH_SIZE} registros.`);

    const summary: MigrationSummary = {
      migrated: 0,
      errors: 0,
      alreadyInR2: await this.countAlreadyMigrated(),
    };

    await this.migrateUsers(summary);
    await this.migrateInventoryAttachments(summary);
    await this.migratePurchaseDocuments(summary);
    await this.migrateWorkOrderSignatureField(
      summary,
      'responsibleMechanicSignature',
    );
    await this.migrateWorkOrderSignatureField(summary, 'shiftSupervisorSignature');

    this.logger.log(
      `Migración finalizada: ${summary.migrated} migrados con éxito, ${summary.errors} errores, ${summary.alreadyInR2} ya estaban en R2.`,
    );
    this.logger.log(
      'Nota: los archivos locales NO fueron eliminados automáticamente.',
    );
    return summary;
  }
}
