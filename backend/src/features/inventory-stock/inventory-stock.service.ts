import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { userCanAccessContractId } from '../../common/contract-scope.util';
import { Prisma, TransactionType } from '@prisma/client';
import Decimal from 'decimal.js';
import { generatePhysicalCountSheetPdfBuffer } from './physical-count-sheet-pdf.generator';
import {
  getPolicyThresholdsForNewItemStockRow,
  clearItemStockPolicyIfMatchesWarehouse,
} from '../inventory-items/inventory-item-stock-policy.helper';
import {
  FIELD_DISPATCH_REFERENCE_TYPE,
  FIELD_RETURN_REFERENCE_TYPE,
} from '../../common/inventory/field-dispatch.constants';
import { getFieldDispatchOutstandingForItem } from '../../common/inventory/field-dispatch-outstanding';
import { userCanViewInventoryCost } from '../auth/permissions.util';

export interface PerformTransactionDto {
  warehouseId: string;
  itemId: string;
  type: TransactionType;
  quantity: number;
  unitCost?: number;
  referenceId?: string;
  referenceType?: string;
  notes?: string;
}

export interface PerformReturnDto {
  warehouseId: string;
  itemId: string;
  quantity: number;
  workOrderId: string; // OT de la que se devuelve
  notes?: string;
}

export interface UpdateStockLevelsDto {
  minStock?: number;
  maxStock?: number;
  /** Ubicación física en esta bodega (pasillo/estante). */
  location?: string | null;
}

@Injectable()
export class InventoryStockService {
  constructor(private readonly prisma: PrismaService) {}

  private assertWarehouseContractAccess(
    user: { role?: string; allowedContracts?: string[] },
    warehouse: { contractId: string },
  ): void {
    if (!userCanAccessContractId(user, warehouse.contractId)) {
      throw new ForbiddenException(
        'No tiene acceso al contrato de esta bodega.',
      );
    }
  }

  private async loadWarehouseForUser(warehouseId: string, user: any) {
    const warehouse = await this.prisma.warehouse.findFirst({
      where: { id: warehouseId, tenantId: user.tenantId },
    });
    if (!warehouse) throw new NotFoundException('Bodega no encontrada');
    this.assertWarehouseContractAccess(user, warehouse);
    return warehouse;
  }

  private ensureItemDescription<
    T extends { description?: string | null; name?: string | null },
  >(item: T): T & { description: string } {
    const normalizedDescription =
      item.description?.trim() || item.name?.trim() || '';
    return {
      ...item,
      description: normalizedDescription,
    };
  }

  private maskCostValue(
    user: { role?: string; permissions?: string[] } | null | undefined,
    value: number | null,
  ): number | null {
    if (userCanViewInventoryCost(user)) return value;
    return 0;
  }

  /**
   * Si el saldo queda ≥ 0, limpia marcas de transacciones pendientes de regularización
   * (stock negativo / consumo sin respaldo administrativo).
   */
  async clearPendingRegularizationFlags(
    tx: Prisma.TransactionClient,
    warehouseId: string,
    itemId: string,
    newQuantity: number,
  ): Promise<void> {
    if (new Decimal(newQuantity).lt(0)) return;
    await tx.inventoryTransaction.updateMany({
      where: {
        warehouseId,
        itemId,
        isPendingRegularization: true,
      },
      data: { isPendingRegularization: false },
    });
  }

  /**
   * Último requerimiento de compra “activo” por artículo de catálogo (para trazabilidad en stock).
   */
  private async mapLatestRequisitionsByItemIds(
    tenantId: string,
    itemIds: string[],
  ): Promise<Map<string, { id: string; correlative: string }>> {
    const out = new Map<string, { id: string; correlative: string }>();
    if (itemIds.length === 0) return out;
    const lines = await this.prisma.requisitionItem.findMany({
      where: {
        inventoryItemId: { in: itemIds },
        requisition: {
          tenantId,
          status: { notIn: ['CANCELLED', 'REJECTED'] },
        },
      },
      select: {
        inventoryItemId: true,
        requisition: {
          select: { id: true, correlative: true, updatedAt: true },
        },
      },
    });
    const agg = new Map<
      string,
      { id: string; correlative: string; updatedAt: Date }[]
    >();
    for (const line of lines) {
      if (!line.inventoryItemId) continue;
      const arr = agg.get(line.inventoryItemId) ?? [];
      arr.push({
        id: line.requisition.id,
        correlative: line.requisition.correlative,
        updatedAt: line.requisition.updatedAt,
      });
      agg.set(line.inventoryItemId, arr);
    }
    for (const [itemId, arr] of agg) {
      arr.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
      out.set(itemId, {
        id: arr[0].id,
        correlative: arr[0].correlative,
      });
    }
    return out;
  }

  private poStatusForSupplyTooltip(st: string): string {
    const m: Record<string, string> = {
      DRAFT: 'Borrador',
      PENDING_APPROVAL: 'Pendiente firma',
      PARTIALLY_APPROVED: 'Firma parcial',
      APPROVED: 'Aprobada',
      SENT: 'En camino',
      ORDERED: 'En camino',
      SENT_TO_SUPPLIER: 'En camino',
      PARTIALLY_RECEIVED: 'Recepción parcial',
      RECEIVED: 'Recibida',
      CLOSED: 'Cerrada',
      CANCELLED: 'Anulada',
      REJECTED: 'Rechazada',
    };
    return m[st] ?? st;
  }

  /**
   * Texto para bodega: REQ, cantidades en OC activa vs pendiente de adjudicación/OC.
   */
  private async linkedPurchaseTooltipText(
    tenantId: string,
    requisitionId: string,
    inventoryItemId: string,
  ): Promise<string> {
    const req = await this.prisma.purchaseRequisition.findFirst({
      where: { id: requisitionId, tenantId },
      select: {
        correlative: true,
        items: {
          where: { inventoryItemId },
          select: {
            quantity: true,
            awardedQuotationItemId: true,
          },
        },
      },
    });
    if (!req) return 'Requerimiento vinculado (sin detalle)';
    if (req.items.length === 0) {
      return `${req.correlative}: sin líneas de este artículo en el SRC`;
    }
    const awardIds = [
      ...new Set(
        req.items
          .map((i) => i.awardedQuotationItemId)
          .filter((id): id is string => id != null),
      ),
    ];
    const hits =
      awardIds.length > 0
        ? await this.prisma.purchaseOrderItem.findMany({
            where: {
              sourceQuotationItemId: { in: awardIds },
              purchaseOrder: {
                tenantId,
                OR: [{ requisitionId }, { quotation: { requisitionId } }],
                status: { notIn: ['CANCELLED', 'REJECTED'] },
              },
            },
            select: {
              quantity: true,
              sourceQuotationItemId: true,
              purchaseOrder: {
                select: { correlative: true, status: true },
              },
            },
          })
        : [];
    const bestByAward = new Map<
      string,
      { correlative: string; status: string; qty: number }
    >();
    for (const h of hits) {
      if (!h.sourceQuotationItemId) continue;
      const qty = Number(h.quantity);
      const cur = bestByAward.get(h.sourceQuotationItemId);
      if (!cur || qty > cur.qty) {
        bestByAward.set(h.sourceQuotationItemId, {
          correlative: h.purchaseOrder.correlative,
          status: h.purchaseOrder.status,
          qty,
        });
      }
    }
    const parts: string[] = [];
    for (const it of req.items) {
      const qn = Number(it.quantity);
      const qtyTxt =
        Number.isInteger(qn) && Math.abs(qn - Math.round(qn)) < 1e-9
          ? String(Math.round(qn))
          : qn.toLocaleString('es-CL', { maximumFractionDigits: 2 });
      if (!it.awardedQuotationItemId) {
        parts.push(`${qtyTxt} uds pendientes de adjudicar`);
        continue;
      }
      const po = bestByAward.get(it.awardedQuotationItemId);
      if (po) {
        parts.push(
          `${qtyTxt} uds en ${po.correlative} (${this.poStatusForSupplyTooltip(po.status)})`,
        );
      } else {
        parts.push(`${qtyTxt} uds adjudicadas, sin OC activa`);
      }
    }
    return `${req.correlative}: ${parts.join('; ')}`;
  }

  /**
   * Ítems con minStock > 0 y cantidad ≤ minStock (tenant completo).
   * Cantidad sugerida: cubrir déficit hasta el mínimo + cobertura de ~30 días según
   * consumo medio mensual (salidas últimos 90 días / 3).
   */
  async getSupplyAlerts(user: any) {
    const tenantId = user.tenantId as string;
    const rows = await this.prisma.itemStock.findMany({
      where: {
        warehouse: { tenantId },
        minStock: { gt: 0 },
      },
      include: {
        warehouse: { select: { id: true, code: true, name: true } },
        item: {
          include: {
            unitOfMeasure: {
              select: { id: true, name: true, abbreviation: true },
            },
            itemCategory: {
              select: {
                id: true,
                name: true,
                parentCategory: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
      orderBy: [
        { warehouse: { code: 'asc' } },
        { item: { partNumber: 'asc' } },
      ],
    });

    const alerts = rows.filter((r) => r.quantity <= r.minStock);

    const uniqueItemIds = [...new Set(alerts.map((a) => a.itemId))];
    const reqByItemId = await this.mapLatestRequisitionsByItemIds(
      tenantId,
      uniqueItemIds,
    );

    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const exitTypes: TransactionType[] = [
      'OUT',
      'WORK_ORDER_ISSUE',
      'TRANSFER_OUT',
    ];

    const pairFilters =
      alerts.length > 0
        ? alerts.map((s) => ({
            warehouseId: s.warehouseId,
            itemId: s.itemId,
          }))
        : [];

    const consumptionRows =
      pairFilters.length === 0
        ? []
        : await this.prisma.inventoryTransaction.groupBy({
            by: ['warehouseId', 'itemId'],
            where: {
              date: { gte: ninetyDaysAgo },
              type: { in: exitTypes },
              OR: pairFilters,
              warehouse: { tenantId },
            },
            _sum: { quantity: true },
          });

    const consumptionMap = new Map<string, number>();
    for (const c of consumptionRows) {
      const key = `${c.warehouseId}:${c.itemId}`;
      consumptionMap.set(key, Number(c._sum.quantity ?? 0));
    }

    const tooltipKeys = [
      ...new Set(
        alerts
          .map((a) => {
            const lr = reqByItemId.get(a.itemId);
            return lr ? `${lr.id}|${a.itemId}` : '';
          })
          .filter((k): k is string => k.length > 0),
      ),
    ];
    const tooltipMap = new Map<string, string>();
    await Promise.all(
      tooltipKeys.map(async (k) => {
        const sep = k.indexOf('|');
        const rid = k.slice(0, sep);
        const iid = k.slice(sep + 1);
        tooltipMap.set(
          k,
          await this.linkedPurchaseTooltipText(tenantId, rid, iid),
        );
      }),
    );

    return alerts.map((s) => {
      const targetOptimal = s.maxStock > 0 ? s.maxStock : s.minStock;
      const key = `${s.warehouseId}:${s.itemId}`;
      const totalOut90d = consumptionMap.get(key) ?? 0;
      const avgMonthlyConsumption = totalOut90d / 3;
      const shortfallToMin = Math.max(0, s.minStock - s.quantity);
      /** Déficit al mínimo + cobertura ~30 días (mismo valor que 1 mes de consumo medio). */
      const suggestedOrderQty = shortfallToMin + avgMonthlyConsumption;

      const lr = reqByItemId.get(s.itemId) ?? null;
      const tipKey = lr ? `${lr.id}|${s.itemId}` : '';
      return {
        id: s.id,
        quantity: s.quantity,
        minStock: s.minStock,
        maxStock: s.maxStock,
        unitCost: this.maskCostValue(
          user,
          s.unitCost != null ? Number(s.unitCost) : null,
        ),
        optimalTarget: targetOptimal,
        /** Salidas registradas (OUT / OT / traslado salida) en los últimos 90 días. */
        consumptionLast90Days: totalOut90d,
        /** Promedio mensual = salidas 90 días / 3; usado como cobertura de ~30 días. */
        avgMonthlyConsumption,
        suggestedOrderQty,
        warehouse: s.warehouse,
        item: this.ensureItemDescription(s.item),
        linkedRequisition: lr,
        linkedPurchaseSummary: tipKey ? (tooltipMap.get(tipKey) ?? null) : null,
      };
    });
  }

  async getStockByWarehouse(
    warehouseId: string,
    user: any,
    opts?: { location?: string },
  ) {
    const tenantId = user.tenantId as string;
    const warehouse = await this.loadWarehouseForUser(warehouseId, user);

    const fieldOutstandingByItem =
      await this.mapFieldDispatchOutstandingForWarehouse(
        tenantId,
        warehouseId,
      );

    const loc = opts?.location?.trim();
    const where: Prisma.ItemStockWhereInput = { warehouseId };
    if (loc) {
      /** Coincidencia parcial sin distinguir mayúsculas (PostgreSQL: ILIKE). */
      where.location = { contains: loc, mode: 'insensitive' };
    }

    const rows = await this.prisma.itemStock.findMany({
      where,
      include: {
        item: {
          include: {
            itemCategory: {
              select: {
                id: true,
                name: true,
                parentCategoryId: true,
                parentCategory: { select: { id: true, name: true } },
              },
            },
            unitOfMeasure: {
              select: { id: true, name: true, abbreviation: true },
            },
          },
        },
      },
      orderBy: { item: { name: 'asc' } },
    });

    const reservedAgg = await this.prisma.stockReservation.groupBy({
      by: ['itemId'],
      where: { warehouseId },
      _sum: { quantity: true },
    });
    const reservedByItemId = new Map(
      reservedAgg.map((a) => [a.itemId, a._sum.quantity ?? 0]),
    );

    const itemIds = [...new Set(rows.map((r) => r.itemId))];
    const reqByItemId = await this.mapLatestRequisitionsByItemIds(
      tenantId,
      itemIds,
    );

    return rows.map((r) => {
      const reservedQuantity = reservedByItemId.get(r.itemId) ?? 0;
      const physicalQuantity = r.quantity;
      const availableQuantity = physicalQuantity - reservedQuantity;
      return {
        ...r,
        reservedQuantity,
        availableQuantity,
        fieldDispatchOutstandingQty:
          fieldOutstandingByItem.get(r.itemId) ?? 0,
        unitCost: this.maskCostValue(
          user,
          r.unitCost != null ? Number(r.unitCost) : null,
        ),
        item: this.ensureItemDescription(r.item),
        linkedRequisition: reqByItemId.get(r.itemId) ?? null,
      };
    });
  }

  /**
   * Por ítem: Σ OUT(referenceType=FIELD_DISPATCH) − Σ IN(referenceType=FIELD_RETURN)
   * en esta bodega (tenant vía warehouse).
   */
  private async mapFieldDispatchOutstandingForWarehouse(
    tenantId: string,
    warehouseId: string,
  ): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    const [outs, ins] = await Promise.all([
      this.prisma.inventoryTransaction.groupBy({
        by: ['itemId'],
        where: {
          warehouseId,
          type: 'OUT',
          referenceType: FIELD_DISPATCH_REFERENCE_TYPE,
          warehouse: { tenantId },
        },
        _sum: { quantity: true },
      }),
      this.prisma.inventoryTransaction.groupBy({
        by: ['itemId'],
        where: {
          warehouseId,
          type: 'IN',
          referenceType: FIELD_RETURN_REFERENCE_TYPE,
          warehouse: { tenantId },
        },
        _sum: { quantity: true },
      }),
    ]);
    const inMap = new Map(
      ins.map((r) => [r.itemId, Number(r._sum.quantity ?? 0)]),
    );
    for (const o of outs) {
      const outQ = Number(o._sum.quantity ?? 0);
      const inQ = inMap.get(o.itemId) ?? 0;
      const net = outQ - inQ;
      if (net > 1e-9) {
        result.set(o.itemId, net);
      }
    }
    return result;
  }

  /**
   * Enriquece transacciones con datos para trazabilidad (recepción/OC, OT, transferencias W2W).
   */
  private async enrichTransactionsTrace<
    T extends {
      type: TransactionType;
      referenceId: string | null;
      referenceType: string | null;
      warehouseId: string;
    },
  >(
    rows: T[],
    tenantId: string,
  ): Promise<Array<T & { trace?: Record<string, unknown> }>> {
    const receiptIds = [
      ...new Set(
        rows
          .filter(
            (r) =>
              r.referenceId &&
              r.referenceType === 'PURCHASE_RECEIPT',
          )
          .map((r) => r.referenceId as string),
      ),
    ];
    const receiptMap = new Map<
      string,
      {
        id: string;
        correlative: string;
        purchaseOrder: { id: string; correlative: string };
      }
    >();
    if (receiptIds.length > 0) {
      const recs = await this.prisma.warehouseReceipt.findMany({
        where: { id: { in: receiptIds }, tenantId },
        select: {
          id: true,
          correlative: true,
          purchaseOrder: { select: { id: true, correlative: true } },
        },
      });
      for (const r of recs) {
        receiptMap.set(r.id, {
          id: r.id,
          correlative: r.correlative,
          purchaseOrder: r.purchaseOrder,
        });
      }
    }

    const woIds = [
      ...new Set(
        rows
          .filter((r) => r.referenceId && r.referenceType === 'WORK_ORDER')
          .map((r) => r.referenceId as string),
      ),
    ];
    const woMap = new Map<
      string,
      { id: string; correlative: string; responsible: string | null }
    >();
    if (woIds.length > 0) {
      const wos = await this.prisma.workOrder.findMany({
        where: { id: { in: woIds }, tenantId },
        select: { id: true, correlative: true, responsible: true },
      });
      for (const w of wos) {
        woMap.set(w.id, w);
      }
    }

    const transferIds = [
      ...new Set(
        rows
          .filter(
            (r) =>
              r.referenceType === 'INVENTORY_TRANSFER' && r.referenceId,
          )
          .map((r) => r.referenceId as string),
      ),
    ];
    const transferMap = new Map<
      string,
      {
        id: string;
        originWarehouseId: string;
        destinationWarehouseId: string;
        originCode: string;
        destCode: string;
        originName: string;
        destName: string;
      }
    >();
    if (transferIds.length > 0) {
      const trs = await this.prisma.inventoryTransfer.findMany({
        where: { id: { in: transferIds }, tenantId },
        select: {
          id: true,
          originWarehouseId: true,
          destinationWarehouseId: true,
          originWarehouse: { select: { code: true, name: true } },
          destinationWarehouse: { select: { code: true, name: true } },
        },
      });
      for (const t of trs) {
        transferMap.set(t.id, {
          id: t.id,
          originWarehouseId: t.originWarehouseId,
          destinationWarehouseId: t.destinationWarehouseId,
          originCode: t.originWarehouse.code,
          destCode: t.destinationWarehouse.code,
          originName: t.originWarehouse.name,
          destName: t.destinationWarehouse.name,
        });
      }
    }

    return rows.map((row) => {
      const trace: Record<string, unknown> = {};
      if (
        row.referenceType === 'PURCHASE_RECEIPT' &&
        row.referenceId
      ) {
        const rc = receiptMap.get(row.referenceId);
        if (rc) {
          trace.warehouseReceipt = {
            id: rc.id,
            correlative: rc.correlative,
          };
          trace.purchaseOrder = rc.purchaseOrder;
          if (row.type === 'ADJUST') {
            trace.saldoPendienteAdjust = true;
          }
        }
      }
      if (row.referenceType === 'WORK_ORDER' && row.referenceId) {
        const wo = woMap.get(row.referenceId);
        if (wo) {
          trace.workOrder = wo;
        }
      }
      if (row.referenceType === 'INVENTORY_TRANSFER' && row.referenceId) {
        const tr = transferMap.get(row.referenceId);
        if (tr) {
          trace.transfer = {
            ...tr,
            direction:
              row.type === 'TRANSFER_OUT' &&
              row.warehouseId === tr.originWarehouseId
                ? ('OUT' as const)
                : row.type === 'TRANSFER_IN' &&
                    row.warehouseId === tr.destinationWarehouseId
                  ? ('IN' as const)
                  : ('OTHER' as const),
          };
        }
      }
      return {
        ...row,
        ...(Object.keys(trace).length ? { trace } : {}),
      };
    });
  }

  async getTransactionsByWarehouse(
    warehouseId: string,
    user: any,
    opts?: { itemId?: string; page?: number; pageSize?: number },
  ) {
    await this.loadWarehouseForUser(warehouseId, user);
    const tenantId = user.tenantId as string;
    const where: Prisma.InventoryTransactionWhereInput = {
      warehouseId,
      warehouse: { tenantId },
    };
    if (opts?.itemId) {
      where.itemId = opts.itemId;
    }

    const include = {
      item: {
        select: {
          partNumber: true,
          name: true,
          description: true,
          unitOfMeasure: {
            select: { id: true, name: true, abbreviation: true },
          },
        },
      },
      user: { select: { id: true, name: true, email: true } },
    } as const;

    if (opts?.itemId) {
      const page = Math.max(1, opts.page ?? 1);
      const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 25));
      const skip = (page - 1) * pageSize;

      const [rows, total] = await Promise.all([
        this.prisma.inventoryTransaction.findMany({
          where,
          include,
          orderBy: { date: 'desc' },
          skip,
          take: pageSize,
        }),
        this.prisma.inventoryTransaction.count({ where }),
      ]);

      const enriched = await this.enrichTransactionsTrace(rows, tenantId);
      const data = enriched.map((row) => ({
        ...row,
        item: this.ensureItemDescription(row.item),
      }));
      return { data, total, page, pageSize };
    }

    const rows = await this.prisma.inventoryTransaction.findMany({
      where,
      include,
      orderBy: { date: 'desc' },
      take: 100,
    });
    const enriched = await this.enrichTransactionsTrace(rows, tenantId);
    return enriched.map((row) => ({
      ...row,
      item: this.ensureItemDescription(row.item),
    }));
  }

  /** Ubicación y cantidad actual en bodega (para movimientos IN/OUT). */
  async getStockPosition(
    warehouseId: string,
    itemId: string,
    user: any,
  ): Promise<{ location: string | null; quantityOnHand: number }> {
    const tenantId = user.tenantId as string;
    await this.loadWarehouseForUser(warehouseId, user);
    const item = await this.prisma.inventoryItem.findFirst({
      where: { id: itemId, tenantId },
      select: { id: true },
    });
    if (!item) {
      throw new NotFoundException('Artículo no encontrado.');
    }
    const st = await this.prisma.itemStock.findUnique({
      where: {
        warehouseId_itemId: { warehouseId, itemId },
      },
      select: { location: true, quantity: true },
    });
    const loc = st?.location?.trim();
    return {
      location: loc ? loc : null,
      quantityOnHand: st?.quantity ?? 0,
    };
  }

  /** Reservas activas (OT no cerrada; al cerrar se eliminan filas). */
  async listStockReservationsForItem(
    warehouseId: string,
    itemId: string,
    user: any,
  ) {
    const tenantId = user.tenantId as string;
    await this.loadWarehouseForUser(warehouseId, user);
    const item = await this.prisma.inventoryItem.findFirst({
      where: { id: itemId, tenantId },
      select: { id: true },
    });
    if (!item) {
      throw new NotFoundException('Artículo no encontrado.');
    }

    const rows = await this.prisma.stockReservation.findMany({
      where: { warehouseId, itemId },
      include: {
        workOrder: {
          select: {
            id: true,
            correlative: true,
            responsible: true,
            status: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return rows.map((r) => ({
      id: r.id,
      quantity: r.quantity,
      reservedAt: r.createdAt,
      workOrder: {
        id: r.workOrder.id,
        correlative: r.workOrder.correlative,
        responsible: r.workOrder.responsible,
        status: r.workOrder.status,
      },
    }));
  }

  /**
   * Transacciones pendientes de regularización (stock negativo).
   */
  async getPendingRegularizations(user: any) {
    const tenantId = user.tenantId;
    const rows = await this.prisma.inventoryTransaction.findMany({
      where: {
        isPendingRegularization: true,
        warehouse: { tenantId },
      },
      include: {
        item: {
          select: {
            partNumber: true,
            name: true,
            description: true,
            unitOfMeasure: {
              select: { id: true, name: true, abbreviation: true },
            },
          },
        },
        warehouse: { select: { code: true, name: true } },
        user: { select: { name: true } },
      },
      orderBy: { date: 'desc' },
    });
    return rows.map((row) => ({
      ...row,
      item: this.ensureItemDescription(row.item),
    }));
  }

  /**
   * Conteo de posiciones (item_stock) con saldo negativo o con transacciones aún
   * marcadas como pendientes de regularización en esa bodega.
   */
  async getPendingCount(user: any): Promise<number> {
    const tenantId = user.tenantId as string;
    const rows = await this.prisma.$queryRaw<{ c: number }[]>(Prisma.sql`
      SELECT COUNT(*)::int AS c
      FROM item_stocks s
      INNER JOIN warehouses w ON w.id = s.warehouse_id
      WHERE w.tenant_id = ${tenantId}::uuid
        AND (
          s.quantity < 0
          OR EXISTS (
            SELECT 1 FROM inventory_transactions t
            WHERE t.warehouse_id = s.warehouse_id
              AND t.item_id = s.item_id
              AND t.is_pending_regularization = true
          )
        )
    `);
    return Number(rows[0]?.c ?? 0);
  }

  async updateStockLevels(
    warehouseId: string,
    itemId: string,
    dto: UpdateStockLevelsDto,
    user: any,
  ) {
    const tenantId = user.tenantId as string;
    await this.loadWarehouseForUser(warehouseId, user);

    const item = await this.prisma.inventoryItem.findFirst({
      where: { id: itemId, tenantId },
      select: { id: true },
    });
    if (!item) throw new NotFoundException('Artículo no encontrado');

    const hasMin = dto.minStock !== undefined && dto.minStock !== null;
    const hasMax = dto.maxStock !== undefined && dto.maxStock !== null;
    const hasLocation = dto.location !== undefined;
    if (!hasMin && !hasMax && !hasLocation) {
      throw new BadRequestException(
        'Debe indicar stock mínimo/máximo y/o ubicación en bodega.',
      );
    }

    const minStock = hasMin ? Number(dto.minStock) : undefined;
    const maxStock = hasMax ? Number(dto.maxStock) : undefined;

    if (
      minStock !== undefined &&
      (!Number.isFinite(minStock) || minStock < 0)
    ) {
      throw new BadRequestException(
        'El stock mínimo debe ser un número mayor o igual a cero.',
      );
    }
    if (
      maxStock !== undefined &&
      (!Number.isFinite(maxStock) || maxStock < 0)
    ) {
      throw new BadRequestException(
        'El stock máximo debe ser un número mayor o igual a cero.',
      );
    }

    const loc =
      dto.location !== undefined
        ? dto.location?.trim()
          ? dto.location.trim().slice(0, 120)
          : null
        : undefined;

    return this.prisma.$transaction(async (tx) => {
      const current = await tx.itemStock.findUnique({
        where: {
          warehouseId_itemId: {
            warehouseId,
            itemId,
          },
        },
        select: {
          quantity: true,
          unitCost: true,
          minStock: true,
          maxStock: true,
          location: true,
        },
      });

      const policyDefaults = !current
        ? await getPolicyThresholdsForNewItemStockRow(
            tx,
            tenantId,
            itemId,
            warehouseId,
          )
        : { minStock: 0, maxStock: 0 };

      const finalMin =
        minStock ?? current?.minStock ?? policyDefaults.minStock;
      const finalMax =
        maxStock ?? current?.maxStock ?? policyDefaults.maxStock;
      if (hasMin || hasMax) {
        if (finalMax > 0 && finalMax < finalMin) {
          throw new BadRequestException(
            'El stock máximo no puede ser menor que el stock mínimo.',
          );
        }
      }

      const row = await tx.itemStock.upsert({
        where: {
          warehouseId_itemId: {
            warehouseId,
            itemId,
          },
        },
        update: {
          minStock: minStock ?? undefined,
          maxStock: maxStock ?? undefined,
          ...(loc !== undefined ? { location: loc } : {}),
        },
        create: {
          warehouseId,
          itemId,
          quantity: current?.quantity ?? 0,
          unitCost: current?.unitCost ?? 0,
          minStock: finalMin,
          maxStock: finalMax,
          ...(loc !== undefined ? { location: loc } : {}),
        },
      });

      await clearItemStockPolicyIfMatchesWarehouse(
        tx,
        tenantId,
        itemId,
        warehouseId,
      );
      return row;
    });
  }

  /**
   * Listado paginado de saldos pendientes de regularización en una bodega.
   */
  async getPendingRegularizationPage(
    warehouseId: string,
    user: any,
    opts: { page?: number; pageSize?: number },
  ) {
    const tenantId = user.tenantId as string;
    const wh = await this.loadWarehouseForUser(warehouseId, user);

    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 25));
    const skip = (page - 1) * pageSize;

    const where: Prisma.ItemStockWhereInput = {
      warehouseId,
      OR: [
        { quantity: { lt: 0 } },
        {
          item: {
            transactions: {
              some: {
                warehouseId,
                isPendingRegularization: true,
              },
            },
          },
        },
      ],
    };

    const [rows, total, receiptsOnApprovedOrdersOnlyCount] = await Promise.all([
      this.prisma.itemStock.findMany({
        where,
        skip,
        take: pageSize,
        include: {
          bin: { select: { id: true, code: true } },
          item: {
            include: {
              unitOfMeasure: {
                select: { id: true, name: true, abbreviation: true },
              },
              itemCategory: {
                select: {
                  id: true,
                  name: true,
                  parentCategory: { select: { id: true, name: true } },
                },
              },
            },
          },
        },
        orderBy: { item: { partNumber: 'asc' } },
      }),
      this.prisma.itemStock.count({ where }),
      this.prisma.warehouseReceipt.count({
        where: {
          warehouseId,
          tenantId,
          purchaseOrder: { status: 'APPROVED' },
        },
      }),
    ]);

    const data = rows.map((s) => {
      const qty = new Decimal(s.quantity);
      const unitCostDec = new Decimal(s.unitCost?.toString() ?? 0);
      const physicalShortageQty = qty.lt(0) ? qty.abs().toNumber() : 0;
      const debtValue = new Decimal(physicalShortageQty)
        .mul(unitCostDec)
        .toDecimalPlaces(4)
        .toNumber();

      return {
        itemStockId: s.id,
        quantity: s.quantity,
        unitCost: this.maskCostValue(
          user,
          s.unitCost != null ? Number(s.unitCost) : null,
        ),
        physicalShortageQty,
        debtValue: userCanViewInventoryCost(user) ? debtValue : 0,
        location: s.location,
        bin: s.bin,
        item: this.ensureItemDescription(s.item),
      };
    });

    return {
      data,
      total,
      page,
      pageSize,
      warehouse: wh,
      /** Recepciones abiertas contra OC solo aprobadas (no marcadas como enviadas): inconsistencia administrativa. */
      receiptsOnApprovedOrdersOnlyCount,
    };
  }

  /**
   * Ejecuta IN, OUT o ADJUST.
   * OUT ahora permite stock negativo, marcando isPendingRegularization.
   */
  async performTransaction(dto: PerformTransactionDto, user: any) {
    const userId = user.id || user.sub;
    if (!userId) {
      throw new BadRequestException(
        'No se pudo identificar al usuario que realiza la transacción.',
      );
    }
    if (dto.quantity <= 0 && dto.type !== 'ADJUST') {
      throw new BadRequestException('La cantidad debe ser mayor a cero.');
    }

    return this.prisma.$transaction(
      async (tx) => this.performTransactionCore(tx, dto, user),
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10_000,
        timeout: 60_000,
      },
    );
  }

  /**
   * Misma lógica que {@link performTransaction} pero dentro de un `tx` existente
   * (p. ej. ajuste «Saldo pendiente» + sincronización de recepción en una sola transacción).
   */
  async performTransactionCore(
    tx: Prisma.TransactionClient,
    dto: PerformTransactionDto,
    user: any,
  ): Promise<{ stock: any; transaction: any }> {
    const userId = user.id || user.sub;
    if (!userId) {
      throw new BadRequestException(
        'No se pudo identificar al usuario que realiza la transacción.',
      );
    }
    if (dto.quantity <= 0 && dto.type !== 'ADJUST') {
      throw new BadRequestException('La cantidad debe ser mayor a cero.');
    }

    const warehouse = await tx.warehouse.findFirst({
      where: { id: dto.warehouseId, tenantId: user.tenantId },
    });
    if (!warehouse) throw new NotFoundException('Bodega no válida.');
    this.assertWarehouseContractAccess(user, warehouse);

    const refType = dto.referenceType?.trim() ?? '';
    if (refType === FIELD_DISPATCH_REFERENCE_TYPE && dto.type !== 'OUT') {
      throw new BadRequestException(
        'FIELD_DISPATCH solo aplica a salidas (OUT).',
      );
    }
    if (refType === FIELD_RETURN_REFERENCE_TYPE && dto.type !== 'IN') {
      throw new BadRequestException(
        'FIELD_RETURN solo aplica a entradas (IN).',
      );
    }
    if (dto.type === 'IN' && refType === FIELD_RETURN_REFERENCE_TYPE) {
      const uc = Number(dto.unitCost ?? 0);
      if (!Number.isFinite(uc) || uc <= 0) {
        throw new BadRequestException(
          'El reingreso desde terreno requiere costo unitario mayor a cero (CPP).',
        );
      }
      const outstanding = await getFieldDispatchOutstandingForItem(
        tx,
        user.tenantId,
        dto.warehouseId,
        dto.itemId,
      );
      if (dto.quantity > outstanding + 1e-6) {
        throw new BadRequestException(
          `La cantidad de reingreso (${dto.quantity}) supera lo pendiente desde terreno (${outstanding}).`,
        );
      }
    }

    const currentStock = await tx.itemStock.findUnique({
      where: {
        warehouseId_itemId: {
          warehouseId: dto.warehouseId,
          itemId: dto.itemId,
        },
      },
    });

    const previousQty = currentStock?.quantity || 0;
    let newQty = previousQty;
    let newUnitCost = Number(currentStock?.unitCost ?? 0);
    let isPendingRegularization = false;

    if (dto.type === 'IN') {
      newQty = previousQty + dto.quantity;

      if (dto.unitCost && dto.unitCost > 0) {
        const cQ = new Decimal(previousQty);
        const cC = new Decimal(Number(currentStock?.unitCost ?? 0));
        const rQ = new Decimal(dto.quantity);
        const rC = new Decimal(dto.unitCost);
        const totalQty = cQ.plus(rQ);
        newUnitCost = totalQty.isZero()
          ? dto.unitCost
          : parseFloat(
              cQ.mul(cC).plus(rQ.mul(rC)).div(totalQty).toFixed(4),
            );
      }
    } else if (dto.type === 'OUT') {
      newQty = previousQty - dto.quantity;
      if (newQty < 0) {
        isPendingRegularization = true;
      }
    } else if (dto.type === 'ADJUST') {
      newQty = previousQty + dto.quantity;
      if (newQty < 0) {
        isPendingRegularization = true;
      }
    }

    const policyDefaults = !currentStock
      ? await getPolicyThresholdsForNewItemStockRow(
          tx,
          user.tenantId,
          dto.itemId,
          dto.warehouseId,
        )
      : { minStock: 0, maxStock: 0 };

    const updatedStock = await tx.itemStock.upsert({
      where: {
        warehouseId_itemId: {
          warehouseId: dto.warehouseId,
          itemId: dto.itemId,
        },
      },
      update: {
        quantity: newQty,
        unitCost: newUnitCost,
      },
      create: {
        warehouseId: dto.warehouseId,
        itemId: dto.itemId,
        quantity: newQty,
        unitCost: dto.unitCost || 0,
        minStock: policyDefaults.minStock,
        maxStock: policyDefaults.maxStock,
      },
    });

    await clearItemStockPolicyIfMatchesWarehouse(
      tx,
      user.tenantId,
      dto.itemId,
      dto.warehouseId,
    );

    const transaction = await tx.inventoryTransaction.create({
      data: {
        type: dto.type,
        quantity: dto.quantity,
        previousStock: previousQty,
        newStock: newQty,
        isPendingRegularization,
        referenceId: dto.referenceId || null,
        referenceType: dto.referenceType || null,
        notes: dto.notes || null,
        warehouse: { connect: { id: dto.warehouseId } },
        item: { connect: { id: dto.itemId } },
        user: { connect: { id: userId } },
      },
    });

    await this.clearPendingRegularizationFlags(
      tx,
      dto.warehouseId,
      dto.itemId,
      newQty,
    );

    const stockMasked = {
      ...updatedStock,
      unitCost: this.maskCostValue(
        user,
        updatedStock.unitCost != null ? Number(updatedStock.unitCost) : null,
      ),
    };
    return { stock: stockMasked, transaction };
  }

  /**
   * Inventory Record Accuracy (IRA), últimos 30 días: ajustes por conteo vs stock sistema.
   * IRA = (1 - sum|delta conteo| / sum stock) × 100
   */
  async getInventoryRecordAccuracy(
    user: any,
    opts?: { warehouseId?: string },
  ): Promise<{
    periodDays: number;
    numerator: number;
    denominator: number;
    iraPercent: number | null;
    note: string;
  }> {
    const tenantId = user.tenantId as string;
    if (opts?.warehouseId) {
      await this.loadWarehouseForUser(opts.warehouseId, user);
    }
    const since = new Date();
    since.setDate(since.getDate() - 30);

    const whereAdj: Prisma.InventoryTransactionWhereInput = {
      warehouse: { tenantId },
      type: 'ADJUST',
      referenceType: 'INVENTORY_ADJUSTMENT',
      date: { gte: since },
      notes: {
        contains: 'Ajuste [Error de conteo]',
        mode: 'insensitive',
      },
    };
    if (opts?.warehouseId) {
      whereAdj.warehouseId = opts.warehouseId;
    }

    const adjustments = await this.prisma.inventoryTransaction.findMany({
      where: whereAdj,
      select: { quantity: true },
    });

    const numerator = adjustments.reduce(
      (s, t) => s + Math.abs(Number(t.quantity)),
      0,
    );

    const whereStock: Prisma.ItemStockWhereInput = {
      warehouse: { tenantId },
    };
    if (opts?.warehouseId) {
      whereStock.warehouseId = opts.warehouseId;
    }

    const agg = await this.prisma.itemStock.aggregate({
      where: whereStock,
      _sum: { quantity: true },
    });
    const denominator = Math.max(0, Number(agg._sum.quantity ?? 0));

    if (denominator < 1e-9) {
      return {
        periodDays: 30,
        numerator,
        denominator,
        iraPercent: null,
        note: 'Sin stock en sistema en el alcance seleccionado; no se puede calcular IRA.',
      };
    }

    const raw = (1 - numerator / denominator) * 100;
    const iraPercent = Math.round(Math.max(0, Math.min(100, raw)) * 100) / 100;

    return {
      periodDays: 30,
      numerator,
      denominator,
      iraPercent,
      note: 'Basado en ajustes por conteo (últimos 30 días) y suma de stock físico en sistema.',
    };
  }

  /**
   * Devolución a bodega (WORK_ORDER_RETURN) atómica vinculada a una OT.
   * Valida que la cantidad devuelta no exceda la consumida originalmente.
   * Incrementa cantidad sin modificar unit_cost (CPP vigente inalterado).
   */
  async performReturn(dto: PerformReturnDto, user: any) {
    if (dto.quantity <= 0) {
      throw new BadRequestException(
        'La cantidad a devolver debe ser mayor a cero.',
      );
    }

    const userId = user.id || user.sub;
    if (!userId) {
      throw new BadRequestException('No se pudo identificar al usuario.');
    }

    return this.prisma.$transaction(
      async (tx) => {
        const outTransactions = await tx.inventoryTransaction.findMany({
          where: {
            warehouseId: dto.warehouseId,
            itemId: dto.itemId,
            referenceId: dto.workOrderId,
            referenceType: 'WORK_ORDER',
            type: { in: ['OUT', 'WORK_ORDER_ISSUE'] },
          },
        });

        if (outTransactions.length === 0) {
          throw new BadRequestException(
            'No se encontraron salidas de este ítem para la OT especificada.',
          );
        }

        const totalConsumed = outTransactions.reduce(
          (sum, t) => sum + t.quantity,
          0,
        );

        // 2. Buscar devoluciones previas para no exceder el tope
        const previousReturns = await tx.inventoryTransaction.findMany({
          where: {
            warehouseId: dto.warehouseId,
            itemId: dto.itemId,
            referenceId: dto.workOrderId,
            referenceType: 'WORK_ORDER',
            type: { in: ['RETURN', 'WORK_ORDER_RETURN'] },
          },
        });

        const totalReturned = previousReturns.reduce(
          (sum, t) => sum + t.quantity,
          0,
        );

        if (totalReturned + dto.quantity > totalConsumed) {
          throw new BadRequestException(
            `Devolución excede el consumo original. Consumido: ${totalConsumed}, Ya devuelto: ${totalReturned}, Intentando devolver: ${dto.quantity}.`,
          );
        }

        // 3. Obtener el unitCost original desde la primera salida
        const currentStock = await tx.itemStock.findUnique({
          where: {
            warehouseId_itemId: {
              warehouseId: dto.warehouseId,
              itemId: dto.itemId,
            },
          },
        });

        const previousQty = currentStock?.quantity || 0;
        const newQty = previousQty + dto.quantity;

        const unitCost = Number(currentStock?.unitCost ?? 0);

        const policyDefaults = !currentStock
          ? await getPolicyThresholdsForNewItemStockRow(
              tx,
              user.tenantId,
              dto.itemId,
              dto.warehouseId,
            )
          : { minStock: 0, maxStock: 0 };

        // 4. Actualizar stock
        await tx.itemStock.upsert({
          where: {
            warehouseId_itemId: {
              warehouseId: dto.warehouseId,
              itemId: dto.itemId,
            },
          },
          update: { quantity: newQty },
          create: {
            warehouseId: dto.warehouseId,
            itemId: dto.itemId,
            quantity: newQty,
            unitCost,
            minStock: policyDefaults.minStock,
            maxStock: policyDefaults.maxStock,
          },
        });

        await clearItemStockPolicyIfMatchesWarehouse(
          tx,
          user.tenantId,
          dto.itemId,
          dto.warehouseId,
        );

        // 5. Registrar devolución a bodega (no recalcula CPP: solo incrementa cantidad)
        const transaction = await tx.inventoryTransaction.create({
          data: {
            type: 'WORK_ORDER_RETURN',
            quantity: dto.quantity,
            previousStock: previousQty,
            newStock: newQty,
            referenceId: dto.workOrderId,
            referenceType: 'WORK_ORDER',
            notes: dto.notes || `Devolución de repuesto vinculada a OT`,
            isPendingRegularization: false,
            warehouse: { connect: { id: dto.warehouseId } },
            item: { connect: { id: dto.itemId } },
            user: { connect: { id: userId } },
          },
        });

        // 6. Si la devolución resuelve un stock que estaba negativo,
        //    verificar si ahora es >= 0 y limpiar flags de regularización
        if (newQty >= 0) {
          // Marcar como regularizadas las transacciones pendientes de este ítem/bodega
          await tx.inventoryTransaction.updateMany({
            where: {
              warehouseId: dto.warehouseId,
              itemId: dto.itemId,
              isPendingRegularization: true,
            },
            data: { isPendingRegularization: false },
          });
        }

        return {
          newStock: newQty,
          unitCost: this.maskCostValue(user, unitCost),
          transaction,
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10_000,
        timeout: 60_000,
      },
    );
  }

  /** PDF de conteo físico a ciegas (sin saldo sistema), ordenado por ubicación. */
  async buildPhysicalCountSheetPdf(
    user: any,
    warehouseId: string,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const tenantId = user.tenantId as string;
    const wh = await this.loadWarehouseForUser(warehouseId, user);

    const stocks = await this.prisma.itemStock.findMany({
      where: { warehouseId, warehouse: { tenantId } },
      select: {
        location: true,
        item: {
          select: {
            inventoryCode: true,
            partNumber: true,
            name: true,
            description: true,
          },
        },
      },
    });

    const pdfRows = stocks.map((r) => {
      const rawDesc = r.item.description?.trim() || r.item.name?.trim() || '—';
      const description =
        rawDesc.length > 120 ? `${rawDesc.slice(0, 117)}…` : rawDesc;
      return {
        inventoryCode: (r.item.inventoryCode ?? '').trim() || '—',
        partNumber: (r.item.partNumber ?? '').trim() || '—',
        description,
        location: (r.location ?? '').trim(),
      };
    });

    const buffer = await generatePhysicalCountSheetPdfBuffer({
      warehouseCode: wh.code,
      warehouseName: wh.name,
      generatedAt: new Date(),
      rows: pdfRows,
    });
    const safe = `${wh.code}-conteo-fisico`.replace(/[^a-zA-Z0-9._-]+/g, '_');
    return { buffer, filename: `${safe}.pdf` };
  }
}
