import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync } from 'fs';
import { readdir, rmdir, stat, unlink } from 'fs/promises';
import { join } from 'path';
import { PrismaService } from '../../prisma/prisma.service';

export const LOCAL_STORAGE_PURGE_PHRASE = 'PURGE_LOCAL_UPLOADS';

export interface LocalStorageSummaryDto {
  driver: string;
  uploadPath: string | null;
  purgeEnabled: boolean;
  fileCount: number;
  totalBytes: number;
}

export interface PurgeLocalStorageResultDto {
  filesRemoved: number;
  bytesFreed: number;
}

export type PurgeDomain =
  | 'purchases'
  | 'inventory-warehouses'
  | 'work-orders'
  | 'maintenance-kits'
  | 'catalog-items'
  | 'fleet-equipment'
  | 'activity-logs'
  | 'push-subscriptions'
  | 'approval-policies'
  | 'inventory-masters';

export const PURGE_DOMAINS: PurgeDomain[] = [
  'purchases',
  'inventory-warehouses',
  'work-orders',
  'maintenance-kits',
  'catalog-items',
  'fleet-equipment',
  'activity-logs',
  'push-subscriptions',
  'approval-policies',
  'inventory-masters',
];

export interface PlatformTenantRow {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}

export interface TenantDataSummaryDto {
  tenantId: string;
  code: string;
  name: string;
  purchases: {
    purchaseDocuments: number;
    purchaseInvoices: number;
    warehouseReceipts: number;
    purchaseOrders: number;
    purchaseQuotations: number;
    purchaseRequisitions: number;
    vendors: number;
    approvalPolicies: number;
  };
  inventory: {
    inventoryTransactions: number;
    inventoryTransfers: number;
    stockReservations: number;
    inventoryItems: number;
    warehouses: number;
    itemCategories: number;
    unitOfMeasures: number;
  };
  operations: {
    workOrders: number;
    maintenanceKits: number;
    catalogItems: number;
    equipments: number;
    contracts: number;
    subcontracts: number;
  };
  platform: {
    activityLogs: number;
    pushSubscriptions: number;
  };
}

export interface PurgeResultDto {
  domain: PurgeDomain;
  tenantId: string;
  deleted: Record<string, number>;
}

const PURCHASE_SEQUENCE_TYPES = ['SRC', 'OC', 'WR'] as const;
const INVENTORY_SEQUENCE_TYPES = ['INV_SKU', 'INV_ITEM_AUTO'] as const;

@Injectable()
export class PlatformDataAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async listTenants(): Promise<PlatformTenantRow[]> {
    return this.prisma.tenant.findMany({
      select: { id: true, code: true, name: true, isActive: true },
      orderBy: { code: 'asc' },
    });
  }

  async createTenant(dto: {
    code: string;
    name: string;
    primaryColor?: string;
  }): Promise<PlatformTenantRow> {
    const codeUpper = dto.code.trim().toUpperCase();
    const existing = await this.prisma.tenant.findUnique({
      where: { code: codeUpper },
    });
    if (existing) {
      throw new BadRequestException('Ya existe una empresa con ese código.');
    }

    return this.prisma.tenant.create({
      data: {
        code: codeUpper,
        name: dto.name.trim(),
        primaryColor: dto.primaryColor?.trim() || '#FF3366',
        isActive: true,
      },
      select: { id: true, code: true, name: true, isActive: true },
    });
  }

  async getTenantDataSummary(tenantId: string): Promise<TenantDataSummaryDto> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, code: true, name: true },
    });
    if (!tenant) throw new NotFoundException('Empresa no encontrada');

    const [
      purchaseDocuments,
      purchaseInvoices,
      warehouseReceipts,
      purchaseOrders,
      purchaseQuotations,
      purchaseRequisitions,
      vendors,
      approvalPolicies,
      inventoryTransactions,
      inventoryTransfers,
      stockReservations,
      inventoryItems,
      warehouses,
      itemCategories,
      unitOfMeasures,
      workOrders,
      maintenanceKits,
      catalogItems,
      equipments,
      contracts,
      subcontracts,
      activityLogs,
      pushSubscriptions,
    ] = await Promise.all([
      this.prisma.purchaseDocument.count({ where: { tenantId } }),
      this.prisma.purchaseInvoice.count({ where: { tenantId } }),
      this.prisma.warehouseReceipt.count({ where: { tenantId } }),
      this.prisma.purchaseOrder.count({ where: { tenantId } }),
      this.prisma.purchaseQuotation.count({ where: { tenantId } }),
      this.prisma.purchaseRequisition.count({ where: { tenantId } }),
      this.prisma.vendor.count({ where: { tenantId } }),
      this.prisma.approvalPolicy.count({ where: { tenantId } }),
      this.prisma.inventoryTransaction.count({
        where: { warehouse: { tenantId } },
      }),
      this.prisma.inventoryTransfer.count({ where: { tenantId } }),
      this.prisma.stockReservation.count({
        where: { warehouse: { tenantId } },
      }),
      this.prisma.inventoryItem.count({ where: { tenantId } }),
      this.prisma.warehouse.count({ where: { tenantId } }),
      this.prisma.itemCategory.count({ where: { tenantId } }),
      this.prisma.unitOfMeasure.count({ where: { tenantId } }),
      this.prisma.workOrder.count({ where: { tenantId } }),
      this.prisma.maintenanceKit.count({ where: { tenantId } }),
      this.prisma.catalogItem.count({ where: { tenantId } }),
      this.prisma.equipment.count({ where: { tenantId } }),
      this.prisma.contract.count({ where: { tenantId } }),
      this.prisma.subcontract.count({
        where: { contract: { tenantId } },
      }),
      this.prisma.activityLog.count({ where: { tenantId } }),
      this.prisma.pushSubscription.count({ where: { tenantId } }),
    ]);

    return {
      tenantId: tenant.id,
      code: tenant.code,
      name: tenant.name,
      purchases: {
        purchaseDocuments,
        purchaseInvoices,
        warehouseReceipts,
        purchaseOrders,
        purchaseQuotations,
        purchaseRequisitions,
        vendors,
        approvalPolicies,
      },
      inventory: {
        inventoryTransactions,
        inventoryTransfers,
        stockReservations,
        inventoryItems,
        warehouses,
        itemCategories,
        unitOfMeasures,
      },
      operations: {
        workOrders,
        maintenanceKits,
        catalogItems,
        equipments,
        contracts,
        subcontracts,
      },
      platform: {
        activityLogs,
        pushSubscriptions,
      },
    };
  }

  private assertConfirmCode(
    tenantCode: string,
    confirmTenantCode: string,
  ): void {
    if (confirmTenantCode.trim() !== tenantCode) {
      throw new BadRequestException(
        'El código de confirmación no coincide con el código de la empresa.',
      );
    }
  }

  private async assertNoWorkOrders(tenantId: string): Promise<void> {
    const n = await this.prisma.workOrder.count({ where: { tenantId } });
    if (n > 0) {
      throw new BadRequestException(
        'Aún hay órdenes de trabajo para esta empresa. Ejecutá primero la purga de OT.',
      );
    }
  }

  private async assertNoInventoryItems(tenantId: string): Promise<void> {
    const n = await this.prisma.inventoryItem.count({ where: { tenantId } });
    if (n > 0) {
      throw new BadRequestException(
        'Aún hay artículos de inventario. Ejecutá primero la purga de inventario y bodegas.',
      );
    }
  }

  async purgeDomain(
    tenantId: string,
    domain: PurgeDomain,
    confirmTenantCode: string,
  ): Promise<PurgeResultDto> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, code: true },
    });
    if (!tenant) throw new NotFoundException('Empresa no encontrada');
    this.assertConfirmCode(tenant.code, confirmTenantCode);

    if (domain === 'purchases') {
      const deleted = await this.prisma.$transaction(async (tx) => {
        const d: Record<string, number> = {};
        d.purchaseDocuments = (
          await tx.purchaseDocument.deleteMany({ where: { tenantId } })
        ).count;
        d.purchaseCreditNotes = (
          await tx.purchaseCreditNote.deleteMany({ where: { tenantId } })
        ).count;
        d.purchaseInvoices = (
          await tx.purchaseInvoice.deleteMany({ where: { tenantId } })
        ).count;
        d.assetCostRecordsPurchaseLinked = (
          await tx.assetCostRecord.deleteMany({
            where: {
              tenantId,
              OR: [
                { purchaseOrderId: { not: null } },
                { warehouseReceiptId: { not: null } },
              ],
            },
          })
        ).count;
        d.warehouseReceipts = (
          await tx.warehouseReceipt.deleteMany({ where: { tenantId } })
        ).count;
        d.purchaseOrders = (
          await tx.purchaseOrder.deleteMany({ where: { tenantId } })
        ).count;
        d.purchaseQuotations = (
          await tx.purchaseQuotation.deleteMany({ where: { tenantId } })
        ).count;
        d.purchaseRequisitions = (
          await tx.purchaseRequisition.deleteMany({ where: { tenantId } })
        ).count;
        d.vendors = (await tx.vendor.deleteMany({ where: { tenantId } })).count;
        d.sequenceCountersPurchases = (
          await tx.sequenceCounter.deleteMany({
            where: {
              tenantId,
              documentType: { in: [...PURCHASE_SEQUENCE_TYPES] },
            },
          })
        ).count;
        return d;
      });
      return { domain, tenantId, deleted };
    }

    if (domain === 'inventory-warehouses') {
      const receiptCount = await this.prisma.warehouseReceipt.count({
        where: { tenantId },
      });
      if (receiptCount > 0) {
        throw new BadRequestException(
          'Aún hay recepciones de compra para esta empresa. Ejecutá primero la purga del módulo de compras.',
        );
      }

      const deleted = await this.prisma.$transaction(async (tx) => {
        const d: Record<string, number> = {};
        d.inventoryTransactions = (
          await tx.inventoryTransaction.deleteMany({
            where: { warehouse: { tenantId } },
          })
        ).count;
        d.inventoryTransfers = (
          await tx.inventoryTransfer.deleteMany({ where: { tenantId } })
        ).count;
        d.stockReservations = (
          await tx.stockReservation.deleteMany({
            where: { warehouse: { tenantId } },
          })
        ).count;
        d.inventoryItems = (
          await tx.inventoryItem.deleteMany({ where: { tenantId } })
        ).count;
        d.warehouses = (
          await tx.warehouse.deleteMany({ where: { tenantId } })
        ).count;
        d.sequenceCountersInventory = (
          await tx.sequenceCounter.deleteMany({
            where: {
              tenantId,
              documentType: { in: [...INVENTORY_SEQUENCE_TYPES] },
            },
          })
        ).count;
        return d;
      });

      return { domain, tenantId, deleted };
    }

    if (domain === 'work-orders') {
      const deleted = await this.prisma.$transaction(async (tx) => {
        const d: Record<string, number> = {};
        d.workOrders = (
          await tx.workOrder.deleteMany({ where: { tenantId } })
        ).count;
        d.assetCostRecordsWorkOrder = (
          await tx.assetCostRecord.deleteMany({
            where: { tenantId, type: 'WORK_ORDER' },
          })
        ).count;
        return d;
      });
      return { domain, tenantId, deleted };
    }

    if (domain === 'maintenance-kits') {
      const deleted = await this.prisma.$transaction(async (tx) => {
        const d: Record<string, number> = {};
        d.maintenanceKits = (
          await tx.maintenanceKit.deleteMany({ where: { tenantId } })
        ).count;
        return d;
      });
      return { domain, tenantId, deleted };
    }

    if (domain === 'catalog-items') {
      await this.assertNoWorkOrders(tenantId);
      const deleted = await this.prisma.$transaction(async (tx) => {
        const d: Record<string, number> = {};
        d.catalogItems = (
          await tx.catalogItem.deleteMany({ where: { tenantId } })
        ).count;
        return d;
      });
      return { domain, tenantId, deleted };
    }

    if (domain === 'fleet-equipment') {
      await this.assertNoWorkOrders(tenantId);
      const deleted = await this.prisma.$transaction(async (tx) => {
        const d: Record<string, number> = {};
        d.equipments = (
          await tx.equipment.deleteMany({ where: { tenantId } })
        ).count;
        return d;
      });
      return { domain, tenantId, deleted };
    }

    if (domain === 'activity-logs') {
      const deleted = await this.prisma.$transaction(async (tx) => {
        const d: Record<string, number> = {};
        d.activityLogs = (
          await tx.activityLog.deleteMany({ where: { tenantId } })
        ).count;
        return d;
      });
      return { domain, tenantId, deleted };
    }

    if (domain === 'push-subscriptions') {
      const deleted = await this.prisma.$transaction(async (tx) => {
        const d: Record<string, number> = {};
        d.pushSubscriptions = (
          await tx.pushSubscription.deleteMany({ where: { tenantId } })
        ).count;
        return d;
      });
      return { domain, tenantId, deleted };
    }

    if (domain === 'approval-policies') {
      const deleted = await this.prisma.$transaction(async (tx) => {
        const d: Record<string, number> = {};
        d.approvalPolicies = (
          await tx.approvalPolicy.deleteMany({ where: { tenantId } })
        ).count;
        return d;
      });
      return { domain, tenantId, deleted };
    }

    if (domain === 'inventory-masters') {
      await this.assertNoInventoryItems(tenantId);
      const deleted = await this.prisma.$transaction(async (tx) => {
        const d: Record<string, number> = {};
        let catTotal = 0;
        for (;;) {
          const r = await tx.itemCategory.deleteMany({
            where: {
              tenantId,
              childCategories: { none: {} },
            },
          });
          catTotal += r.count;
          if (r.count === 0) break;
        }
        d.itemCategories = catTotal;
        d.unitOfMeasures = (
          await tx.unitOfMeasure.deleteMany({ where: { tenantId } })
        ).count;
        return d;
      });
      return { domain, tenantId, deleted };
    }

    throw new BadRequestException('Dominio de purga no implementado.');
  }

  async getLocalStorageSummary(): Promise<LocalStorageSummaryDto> {
    const driver = (
      this.config.get<string>('STORAGE_DRIVER') || 'local'
    ).toLowerCase();
    if (driver !== 'local') {
      return {
        driver,
        uploadPath: null,
        purgeEnabled: false,
        fileCount: 0,
        totalBytes: 0,
      };
    }
    const uploadPath =
      this.config.get<string>('UPLOAD_PATH')?.trim() || './uploads';
    const purgeEnabled =
      this.config.get<string>('ALLOW_LOCAL_STORAGE_PURGE') === 'true';
    const { fileCount, totalBytes } =
      await this.scanLocalUploadDirectory(uploadPath);
    return {
      driver,
      uploadPath,
      purgeEnabled,
      fileCount,
      totalBytes,
    };
  }

  async purgeLocalStorage(
    confirmPhrase: string,
  ): Promise<PurgeLocalStorageResultDto> {
    if (confirmPhrase.trim() !== LOCAL_STORAGE_PURGE_PHRASE) {
      throw new BadRequestException(
        `Frase incorrecta. Escriba exactamente: ${LOCAL_STORAGE_PURGE_PHRASE}`,
      );
    }
    if (this.config.get<string>('ALLOW_LOCAL_STORAGE_PURGE') !== 'true') {
      throw new BadRequestException(
        'Purga de archivos locales deshabilitada (ALLOW_LOCAL_STORAGE_PURGE).',
      );
    }
    const driver = (
      this.config.get<string>('STORAGE_DRIVER') || 'local'
    ).toLowerCase();
    if (driver !== 'local') {
      throw new BadRequestException(
        'Solo disponible con STORAGE_DRIVER=local (QA / disco).',
      );
    }
    const uploadPath =
      this.config.get<string>('UPLOAD_PATH')?.trim() || './uploads';
    if (!existsSync(uploadPath)) {
      return { filesRemoved: 0, bytesFreed: 0 };
    }
    return this.emptyLocalUploadDirectory(uploadPath);
  }

  private async scanLocalUploadDirectory(
    root: string,
  ): Promise<{ fileCount: number; totalBytes: number }> {
    if (!existsSync(root)) {
      return { fileCount: 0, totalBytes: 0 };
    }
    let fileCount = 0;
    let totalBytes = 0;
    const walk = async (dir: string) => {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
        } else if (entry.isFile()) {
          const s = await stat(full);
          fileCount += 1;
          totalBytes += s.size;
        }
      }
    };
    await walk(root);
    return { fileCount, totalBytes };
  }

  private async emptyLocalUploadDirectory(
    root: string,
  ): Promise<PurgeLocalStorageResultDto> {
    let filesRemoved = 0;
    let bytesFreed = 0;
    const walk = async (dir: string) => {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
          await rmdir(full);
        } else if (entry.isFile()) {
          const s = await stat(full);
          bytesFreed += s.size;
          await unlink(full);
          filesRemoved += 1;
        }
      }
    };
    await walk(root);
    return { filesRemoved, bytesFreed };
  }
}
