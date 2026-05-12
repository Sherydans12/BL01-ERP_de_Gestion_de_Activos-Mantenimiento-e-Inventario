import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

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
  constructor(private readonly prisma: PrismaService) {}

  async listTenants(): Promise<PlatformTenantRow[]> {
    return this.prisma.tenant.findMany({
      select: { id: true, code: true, name: true, isActive: true },
      orderBy: { code: 'asc' },
    });
  }

  async createTenant(dto: { code: string; name: string; primaryColor?: string }): Promise<PlatformTenantRow> {
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
}
