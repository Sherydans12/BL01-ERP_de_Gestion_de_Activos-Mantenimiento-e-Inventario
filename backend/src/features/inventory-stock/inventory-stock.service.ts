import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma, TransactionType } from '@prisma/client';
import Decimal from 'decimal.js';

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

  private isMechanic(user: { role?: string } | null | undefined): boolean {
    return user?.role === 'MECHANIC';
  }

  private maskCostValue(
    user: { role?: string } | null | undefined,
    value: number | null,
  ): number | null {
    if (!this.isMechanic(user)) return value;
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
                OR: [
                  { requisitionId },
                  { quotation: { requisitionId } },
                ],
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

  async getStockByWarehouse(warehouseId: string, user: any) {
    const tenantId = user.tenantId as string;
    const warehouse = await this.prisma.warehouse.findFirst({
      where: { id: warehouseId, tenantId },
    });
    if (!warehouse) throw new NotFoundException('Bodega no encontrada');

    const rows = await this.prisma.itemStock.findMany({
      where: { warehouseId },
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

    const itemIds = [...new Set(rows.map((r) => r.itemId))];
    const reqByItemId = await this.mapLatestRequisitionsByItemIds(
      tenantId,
      itemIds,
    );

    return rows.map((r) => ({
      ...r,
      unitCost: this.maskCostValue(user, r.unitCost != null ? Number(r.unitCost) : null),
      item: this.ensureItemDescription(r.item),
      linkedRequisition: reqByItemId.get(r.itemId) ?? null,
    }));
  }

  async getTransactionsByWarehouse(warehouseId: string, user: any) {
    const rows = await this.prisma.inventoryTransaction.findMany({
      where: { warehouseId, warehouse: { tenantId: user.tenantId } },
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
        user: { select: { name: true, email: true } },
      },
      orderBy: { date: 'desc' },
      take: 100,
    });
    return rows.map((row) => ({
      ...row,
      item: this.ensureItemDescription(row.item),
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
    const warehouse = await this.prisma.warehouse.findFirst({
      where: { id: warehouseId, tenantId },
      select: { id: true },
    });
    if (!warehouse) throw new NotFoundException('Bodega no encontrada');

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

    if (minStock !== undefined && (!Number.isFinite(minStock) || minStock < 0)) {
      throw new BadRequestException(
        'El stock mínimo debe ser un número mayor o igual a cero.',
      );
    }
    if (maxStock !== undefined && (!Number.isFinite(maxStock) || maxStock < 0)) {
      throw new BadRequestException(
        'El stock máximo debe ser un número mayor o igual a cero.',
      );
    }

    const current = await this.prisma.itemStock.findUnique({
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

    const finalMin = minStock ?? current?.minStock ?? 0;
    const finalMax = maxStock ?? current?.maxStock ?? 0;
    if (hasMin || hasMax) {
      if (finalMax > 0 && finalMax < finalMin) {
        throw new BadRequestException(
          'El stock máximo no puede ser menor que el stock mínimo.',
        );
      }
    }

    const loc =
      dto.location !== undefined
        ? (dto.location?.trim() ? dto.location.trim().slice(0, 120) : null)
        : undefined;

    return this.prisma.itemStock.upsert({
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
        ...(loc !== undefined
          ? { location: loc }
          : {}),
      },
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
    const wh = await this.prisma.warehouse.findFirst({
      where: { id: warehouseId, tenantId },
      select: { id: true, code: true, name: true },
    });
    if (!wh) {
      throw new NotFoundException('Bodega no encontrada');
    }

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
        debtValue: this.isMechanic(user) ? 0 : debtValue,
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
    if (dto.quantity <= 0 && dto.type !== 'ADJUST') {
      throw new BadRequestException('La cantidad debe ser mayor a cero.');
    }

    const userId = user.id || user.sub;
    if (!userId) {
      throw new BadRequestException(
        'No se pudo identificar al usuario que realiza la transacción.',
      );
    }

    return this.prisma.$transaction(
      async (tx) => {
        const warehouse = await tx.warehouse.findFirst({
          where: { id: dto.warehouseId, tenantId: user.tenantId },
        });
        if (!warehouse) throw new NotFoundException('Bodega no válida.');

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
          },
        });

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
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10_000,
        timeout: 60_000,
      },
    );
  }

  /**
   * Devolución (RETURN) atómica vinculada a una OT.
   * Valida que la cantidad devuelta no exceda la consumida originalmente.
   * Usa el unitCost original de la salida para proteger el CPP.
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
            type: 'RETURN',
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
          },
        });

        // 5. Registrar transacción RETURN
        const transaction = await tx.inventoryTransaction.create({
          data: {
            type: 'RETURN',
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
}
