import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { NotificationChannel, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SequenceService } from '../../common/sequence/sequence.service';
import { StorageService } from '../../common/storage/storage.service';
import { CreateInventoryItemDto } from './dto/create-inventory-item.dto';
import { UpdateInventoryItemDto } from './dto/update-inventory-item.dto';
import type { QuickCreateItemDto } from './dto/quick-create-item.dto';
import {
  generateInventoryItemLabelPdfBuffer,
  type InventoryLabelQrMode,
  type InventoryLabelSize,
} from './inventory-item-label-pdf.generator';
import { listItemIdsWithFieldDispatchOutstanding } from '../../common/inventory/field-dispatch-outstanding';
import { NotificationDispatcherService } from '../../common/notifications/notification-dispatcher.service';
import { NOTIFICATION_EVENTS } from '../../common/notifications/notification-events';
import { buildMailInventoryItemCreated } from '../../common/email/transactional-mail.builder';
import { AuditService } from '../../common/audit/audit.service';

const INV_SKU_DOC_TYPE = 'INV_SKU';
/** Prefijo código de inventario autogenerado: `IN` + 4 dígitos (p. ej. IN0042). */
const INV_SKU_PREFIX = 'IN';

const ITEM_CATEGORY_SELECT = {
  id: true,
  name: true,
  parentCategoryId: true,
  parentCategory: { select: { id: true, name: true } },
} as const;

const UOM_SELECT = {
  id: true,
  name: true,
  abbreviation: true,
  allowsDecimals: true,
} as const;

/** Familia (nombre padre) → subcategoría → artículo (PostgreSQL / Prisma). */
const ITEM_CATALOG_ORDER_BY: Prisma.InventoryItemOrderByWithRelationInput[] = [
  { itemCategory: { parentCategory: { name: 'asc' } } },
  { itemCategory: { name: 'asc' } },
  { name: 'asc' },
];

@Injectable()
export class InventoryItemsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequenceService: SequenceService,
    private readonly storageService: StorageService,
    private readonly config: ConfigService,
    private readonly notificationDispatcher: NotificationDispatcherService,
    private readonly audit: AuditService,
  ) {}

  private sortRowsBySearchIdOrder<T extends { id: string }>(
    rows: T[],
    orderedIds: string[],
  ): T[] {
    const rank = new Map(orderedIds.map((id, i) => [id, i]));
    return [...rows].sort(
      (a, b) => (rank.get(a.id) ?? 999_999) - (rank.get(b.id) ?? 999_999),
    );
  }

  private isMechanic(user: { role?: string } | null | undefined): boolean {
    return user?.role === 'MECHANIC';
  }

  private maskPickerCostByRole(
    user: { role?: string } | null | undefined,
    value: number | null,
  ): number | null {
    if (!this.isMechanic(user)) return value;
    return null;
  }

  /** Máximo numérico en códigos `IN####` o legado `INV-#####` (tenant). */
  private computeInventorySkuNumericFloor(
    rows: Iterable<{ inventoryCode: string | null }>,
  ): number {
    let floor = 0;
    for (const { inventoryCode } of rows) {
      const t = (inventoryCode ?? '').trim();
      if (!t) continue;
      const mNew = /^IN(\d{1,8})$/i.exec(t);
      if (mNew) floor = Math.max(floor, parseInt(mNew[1]!, 10));
      const mOld = /^INV-(\d{1,8})$/i.exec(t);
      if (mOld) floor = Math.max(floor, parseInt(mOld[1]!, 10));
    }
    return floor;
  }

  /**
   * Siguiente SKU que asignaría el sistema (solo lectura; no reserva correlativo).
   * Debe coincidir con `create`/`quickCreate` salvo carrera entre usuarios.
   */
  async peekNextInventorySku(user: { tenantId: string }): Promise<{
    inventoryCode: string;
  }> {
    const tenantId = user.tenantId;
    const rows = await this.prisma.inventoryItem.findMany({
      where: { tenantId, inventoryCode: { not: null } },
      select: { inventoryCode: true },
    });
    const floor = this.computeInventorySkuNumericFloor(rows);
    const counter = await this.prisma.sequenceCounter.findUnique({
      where: {
        tenantId_documentType: {
          tenantId,
          documentType: INV_SKU_DOC_TYPE,
        },
      },
    });
    const counterVal = counter?.lastNumber ?? 0;
    const synced = Math.max(floor, counterVal);
    const nextNum = synced + 1;
    const padWidth = 4;
    return {
      inventoryCode: `${INV_SKU_PREFIX}${String(nextNum).padStart(padWidth, '0')}`,
    };
  }

  /**
   * Alinea `sequence_counters` (INV_SKU) con el máximo numérico ya presente en
   * `inventory_code` (formato `IN####` o legado `INV-#####`) para que el
   * siguiente autogenerado no repita ni quede por debajo de importaciones.
   */
  private async ensureInventorySkuCounterFloor(
    tenantId: string,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    const rows = await tx.inventoryItem.findMany({
      where: { tenantId, inventoryCode: { not: null } },
      select: { inventoryCode: true },
    });
    const floor = this.computeInventorySkuNumericFloor(rows);
    if (floor <= 0) return;

    const counter = await tx.sequenceCounter.findUnique({
      where: {
        tenantId_documentType: {
          tenantId,
          documentType: INV_SKU_DOC_TYPE,
        },
      },
    });
    if (!counter || counter.lastNumber < floor) {
      await tx.sequenceCounter.upsert({
        where: {
          tenantId_documentType: {
            tenantId,
            documentType: INV_SKU_DOC_TYPE,
          },
        },
        create: {
          tenantId,
          documentType: INV_SKU_DOC_TYPE,
          prefix: INV_SKU_PREFIX,
          lastNumber: floor,
        },
        update: {
          lastNumber: floor,
          prefix: INV_SKU_PREFIX,
        },
      });
    }
  }

  /**
   * Patrón ILIKE '%…%' con escape de comodines para uso con pg_trgm (GIN).
   */
  private static ilikeContainsPattern(q: string): string {
    const s = q
      .replace(/\\/g, '\\\\')
      .replace(/%/g, '\\%')
      .replace(/_/g, '\\_');
    return `%${s}%`;
  }

  /**
   * Resuelve IDs por texto (nombre, parte, descripción, qr_code, compatibilidad) con SQL parametrizado
   * para favorecer planes con índices gin_trgm en columnas de texto.
   */
  private async searchInventoryItemIdsPgTrgm(
    tenantId: string,
    q: string,
  ): Promise<string[]> {
    const trimmed = q.trim();
    if (!trimmed) {
      return [];
    }
    const pat = InventoryItemsService.ilikeContainsPattern(trimmed);
    const rows = await this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT i.id
      FROM inventory_items i
      WHERE i.tenant_id = ${tenantId}::uuid
        AND (
          (i.inventory_code IS NOT NULL AND i.inventory_code ILIKE ${pat} ESCAPE '\\')
          OR i.name ILIKE ${pat} ESCAPE '\\'
          OR i.part_number ILIKE ${pat} ESCAPE '\\'
          OR COALESCE(i.description, '') ILIKE ${pat} ESCAPE '\\'
          OR COALESCE(i.compatibility_info, '') ILIKE ${pat} ESCAPE '\\'
          OR i.qr_code ILIKE ${pat} ESCAPE '\\'
          OR TRIM(i.part_number) = TRIM(${trimmed})
          OR (i.inventory_code IS NOT NULL AND TRIM(i.inventory_code) = TRIM(${trimmed}))
          OR TRIM(i.qr_code) = TRIM(${trimmed})
        )
      ORDER BY
        CASE
          WHEN i.inventory_code IS NOT NULL AND TRIM(i.inventory_code) = TRIM(${trimmed}) THEN 0
          WHEN i.inventory_code IS NOT NULL AND i.inventory_code ILIKE ${pat} ESCAPE '\\' THEN 1
          WHEN TRIM(i.part_number) = TRIM(${trimmed}) THEN 2
          WHEN i.part_number ILIKE ${pat} ESCAPE '\\' THEN 3
          ELSE 4
        END,
        i.name ASC
    `);
    return rows.map((r) => r.id);
  }

  /**
   * Filtros compartidos: IDs por texto (pg_trgm) y categoría.
   * Si `searchIds` es `[]`, no usar este helper sin un early-return previo (evita `IN ()`).
   */
  private async buildInventoryItemWhere(
    tenantId: string,
    opts: {
      categoryId?: string;
      searchIds?: string[];
    },
  ): Promise<Prisma.InventoryItemWhereInput> {
    const where: Prisma.InventoryItemWhereInput = { tenantId };

    if (opts.searchIds !== undefined) {
      where.id = { in: opts.searchIds };
    }

    if (opts.categoryId?.trim()) {
      const cat = await this.prisma.itemCategory.findFirst({
        where: { id: opts.categoryId.trim(), tenantId },
      });
      if (cat) {
        if (!cat.parentCategoryId) {
          where.itemCategory = { parentCategoryId: opts.categoryId.trim() };
        } else {
          where.categoryId = opts.categoryId.trim();
        }
      }
    }

    return where;
  }

  /** Catálogo maestro paginado (GET /inventory-items). */
  async findCatalog(
    user: any,
    opts: {
      page?: number;
      pageSize?: number;
      search?: string;
      categoryId?: string;
    },
  ) {
    const tenantId = user.tenantId as string;
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, opts.pageSize ?? 25));
    const q = opts.search?.trim();
    const skip = (page - 1) * pageSize;

    if (q) {
      const orderedSearchIds = await this.searchInventoryItemIdsPgTrgm(
        tenantId,
        q,
      );
      if (orderedSearchIds.length === 0) {
        return { data: [], total: 0, page, pageSize };
      }
      const where = await this.buildInventoryItemWhere(tenantId, {
        categoryId: opts.categoryId,
        searchIds: orderedSearchIds,
      });
      const matching = await this.prisma.inventoryItem.findMany({
        where,
        select: { id: true },
      });
      const idSet = new Set(matching.map((r) => r.id));
      const orderedFiltered = orderedSearchIds.filter((id) => idSet.has(id));
      const total = orderedFiltered.length;
      const pageIds = orderedFiltered.slice(skip, skip + pageSize);
      if (pageIds.length === 0) {
        return { data: [], total, page, pageSize };
      }
      const rawData = await this.prisma.inventoryItem.findMany({
        where: { id: { in: pageIds } },
        include: {
          itemCategory: { select: ITEM_CATEGORY_SELECT },
          unitOfMeasure: { select: UOM_SELECT },
        },
      });
      const data = this.sortRowsBySearchIdOrder(rawData, pageIds);
      return { data, total, page, pageSize };
    }

    const where = await this.buildInventoryItemWhere(tenantId, {
      categoryId: opts.categoryId,
    });
    const [data, total] = await Promise.all([
      this.prisma.inventoryItem.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: ITEM_CATALOG_ORDER_BY,
        include: {
          itemCategory: { select: ITEM_CATEGORY_SELECT },
          unitOfMeasure: { select: UOM_SELECT },
        },
      }),
      this.prisma.inventoryItem.count({ where }),
    ]);

    return { data, total, page, pageSize };
  }

  /** Solo subcategorías (hoja); no familias sueltas. Valida familia misma tenant. */
  private async assertLeafCategory(categoryId: string, tenantId: string) {
    const cat = await this.prisma.itemCategory.findFirst({
      where: { id: categoryId, tenantId },
    });
    if (!cat) {
      throw new BadRequestException(
        'La categoría no existe o no pertenece a su empresa.',
      );
    }
    if (!cat.parentCategoryId) {
      throw new BadRequestException(
        'Debe seleccionar una subcategoría (no una familia de nivel superior).',
      );
    }
    const parent = await this.prisma.itemCategory.findFirst({
      where: { id: cat.parentCategoryId, tenantId },
    });
    if (!parent) {
      throw new BadRequestException(
        'La familia de la subcategoría no existe o no pertenece a su empresa.',
      );
    }
    if (parent.parentCategoryId) {
      throw new BadRequestException(
        'Solo se permiten dos niveles: familia y subcategoría.',
      );
    }
    return cat;
  }

  private async assertUnitOfMeasure(id: string, tenantId: string) {
    const u = await this.prisma.unitOfMeasure.findFirst({
      where: { id, tenantId },
    });
    if (!u) {
      throw new BadRequestException('Unidad de medida no válida.');
    }
    return u;
  }

  private async assertUnitOfMeasureTx(
    tx: Prisma.TransactionClient,
    id: string,
    tenantId: string,
  ) {
    const u = await tx.unitOfMeasure.findFirst({
      where: { id, tenantId },
    });
    if (!u) {
      throw new BadRequestException('Unidad de medida no válida.');
    }
    return u;
  }

  /**
   * Ítems con salidas (OUT / WORK_ORDER_ISSUE) a una OT desde una bodega y
   * cantidad neta aún devolvible (misma lógica que `performReturn`).
   */
  private async listReturnableItemIdsForWorkOrder(
    tenantId: string,
    warehouseId: string,
    workOrderId: string,
  ): Promise<string[]> {
    const [outs, rets] = await Promise.all([
      this.prisma.inventoryTransaction.groupBy({
        by: ['itemId'],
        where: {
          warehouseId,
          referenceId: workOrderId,
          referenceType: 'WORK_ORDER',
          type: { in: ['OUT', 'WORK_ORDER_ISSUE'] },
          warehouse: { tenantId },
        },
        _sum: { quantity: true },
      }),
      this.prisma.inventoryTransaction.groupBy({
        by: ['itemId'],
        where: {
          warehouseId,
          referenceId: workOrderId,
          referenceType: 'WORK_ORDER',
          type: { in: ['RETURN', 'WORK_ORDER_RETURN'] },
          warehouse: { tenantId },
        },
        _sum: { quantity: true },
      }),
    ]);

    const returned = new Map(
      rets.map((r) => [r.itemId, Number(r._sum.quantity ?? 0)]),
    );
    const ids: string[] = [];
    for (const o of outs) {
      const consumed = Number(o._sum.quantity ?? 0);
      const prevRet = returned.get(o.itemId) ?? 0;
      if (consumed - prevRet > 1e-9) {
        ids.push(o.itemId);
      }
    }
    return ids;
  }

  /**
   * Listado paginado para selectores (Catálogo Maestro): búsqueda por texto,
   * filtro por familia o subcategoría, y saldo opcional por bodega.
   */
  async findForPicker(
    user: any,
    opts: {
      search?: string;
      categoryId?: string;
      warehouseId?: string;
      /** Solo artículos con fila de stock y quantity &gt; 0 en esa bodega. */
      onlyWithStockInWarehouse?: boolean;
      /**
       * Solo ítems con consumo hacia esta OT desde la bodega indicada y cantidad
       * aún devolvible (requiere `warehouseId`). Usado en devolución a bodega desde OT.
       */
      workOrderReturnFilterId?: string;
      /**
       * Solo ítems con saldo neto pendiente de reingreso (OUT `FIELD_DISPATCH` − IN `FIELD_RETURN`)
       * en la bodega (requiere `warehouseId`).
       */
      fieldReentryOutstanding?: boolean;
      page?: number;
      pageSize?: number;
    },
  ) {
    const tenantId = user.tenantId as string;
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 20));

    const q = opts.search?.trim();
    const skip = (page - 1) * pageSize;

    let warehouseIdForStock: string | undefined;
    if (opts.warehouseId?.trim()) {
      const wh = await this.prisma.warehouse.findFirst({
        where: { id: opts.warehouseId.trim(), tenantId },
        select: { id: true },
      });
      if (wh) {
        warehouseIdForStock = wh.id;
      }
    }

    const onlyWithStock =
      opts.onlyWithStockInWarehouse === true && !!warehouseIdForStock;

    const stockWhere: Prisma.InventoryItemWhereInput | undefined = onlyWithStock
      ? {
          stocks: {
            some: {
              warehouseId: warehouseIdForStock as string,
              quantity: { gt: 0 },
            },
          },
        }
      : undefined;

    const woTrim = opts.workOrderReturnFilterId?.trim();
    let woReturnWhere: Prisma.InventoryItemWhereInput | undefined;
    if (woTrim) {
      if (!warehouseIdForStock) {
        woReturnWhere = { id: { in: [] } };
      } else {
        const wo = await this.prisma.workOrder.findFirst({
          where: { id: woTrim, tenantId },
          select: { id: true },
        });
        if (!wo) {
          woReturnWhere = { id: { in: [] } };
        } else {
          const ids = await this.listReturnableItemIdsForWorkOrder(
            tenantId,
            warehouseIdForStock,
            woTrim,
          );
          woReturnWhere = { id: { in: ids } };
        }
      }
    }

    let fieldReentryWhere: Prisma.InventoryItemWhereInput | undefined;
    if (opts.fieldReentryOutstanding === true) {
      if (!warehouseIdForStock) {
        fieldReentryWhere = { id: { in: [] } };
      } else {
        const ids = await listItemIdsWithFieldDispatchOutstanding(
          this.prisma,
          tenantId,
          warehouseIdForStock,
        );
        fieldReentryWhere = { id: { in: ids.length ? ids : [] } };
      }
    }

    const mergePickerWhere = (
      base: Prisma.InventoryItemWhereInput,
    ): Prisma.InventoryItemWhereInput => {
      const extras: Prisma.InventoryItemWhereInput[] = [];
      if (stockWhere) extras.push(stockWhere);
      if (woReturnWhere) extras.push(woReturnWhere);
      if (fieldReentryWhere) extras.push(fieldReentryWhere);
      if (!extras.length) return base;
      return { AND: [base, ...extras] };
    };

    const include: Prisma.InventoryItemInclude = {
      itemCategory: { select: ITEM_CATEGORY_SELECT },
      unitOfMeasure: { select: UOM_SELECT },
    };
    if (warehouseIdForStock) {
      include.stocks = {
        where: { warehouseId: warehouseIdForStock },
        select: {
          quantity: true,
          unitCost: true,
          location: true,
          minStock: true,
        },
      };
    }

    let rows: Array<
      Prisma.InventoryItemGetPayload<{ include: typeof include }>
    >;
    let total: number;

    if (q) {
      const orderedSearchIds = await this.searchInventoryItemIdsPgTrgm(
        tenantId,
        q,
      );
      if (orderedSearchIds.length === 0) {
        return {
          data: [],
          total: 0,
          page,
          pageSize,
        };
      }
      const where = mergePickerWhere(
        await this.buildInventoryItemWhere(tenantId, {
          categoryId: opts.categoryId,
          searchIds: orderedSearchIds,
        }),
      );
      const matching = await this.prisma.inventoryItem.findMany({
        where,
        select: { id: true },
      });
      const idSet = new Set(matching.map((r) => r.id));
      const orderedFiltered = orderedSearchIds.filter((id) => idSet.has(id));
      total = orderedFiltered.length;
      const pageIds = orderedFiltered.slice(skip, skip + pageSize);
      if (pageIds.length === 0) {
        return {
          data: [],
          total,
          page,
          pageSize,
        };
      }
      rows = await this.prisma.inventoryItem.findMany({
        where: { id: { in: pageIds } },
        include,
      });
      rows = this.sortRowsBySearchIdOrder(rows, pageIds);
    } else {
      const where = mergePickerWhere(
        await this.buildInventoryItemWhere(tenantId, {
          categoryId: opts.categoryId,
        }),
      );
      const [r, t] = await Promise.all([
        this.prisma.inventoryItem.findMany({
          where,
          skip,
          take: pageSize,
          orderBy: ITEM_CATALOG_ORDER_BY,
          include,
        }),
        this.prisma.inventoryItem.count({ where }),
      ]);
      rows = r;
      total = t;
    }

    let reservedByItemId = new Map<string, number>();
    if (warehouseIdForStock && rows.length > 0) {
      const ids = rows.map((r) => r.id);
      const reservedAgg = await this.prisma.stockReservation.groupBy({
        by: ['itemId'],
        where: {
          warehouseId: warehouseIdForStock,
          itemId: { in: ids },
        },
        _sum: { quantity: true },
      });
      reservedByItemId = new Map(
        reservedAgg.map((a) => [a.itemId, a._sum.quantity ?? 0]),
      );
    }

    return {
      data: rows.map((item) => {
        const row = item as typeof item & {
          stocks?: {
            quantity: number;
            unitCost: unknown;
            minStock?: number;
          }[];
        };
        const stocks = row.stocks;
        let stockQuantity: number | null = null;
        let stockUnitCost: number | null = null;
        let stockLocation: string | null = null;
        let stockCritical = false;
        if (warehouseIdForStock) {
          stockQuantity = stocks?.length ? stocks[0].quantity : 0;
          const uc = stocks?.length ? stocks[0].unitCost : null;
          stockUnitCost = uc !== null && uc !== undefined ? Number(uc) : null;
          const rawLoc = stocks?.length ? stocks[0].location : null;
          stockLocation =
            rawLoc != null && String(rawLoc).trim()
              ? String(rawLoc).trim()
              : null;
          const minS = stocks?.length ? Number(stocks[0].minStock ?? 0) : 0;
          const reserved = reservedByItemId.get(row.id) ?? 0;
          const physical = Number(stockQuantity ?? 0);
          const available = physical - reserved;
          stockCritical = minS > 0 && available < minS;
        } else {
          stockUnitCost = null;
        }
        return {
          id: row.id,
          qrCode: row.qrCode,
          inventoryCode: row.inventoryCode,
          partNumber: row.partNumber,
          name: row.name,
          description: row.description,
          unitOfMeasure: row.unitOfMeasure,
          brand: row.brand,
          compatibilityInfo: row.compatibilityInfo,
          categoryId: row.categoryId,
          itemCategory: row.itemCategory,
          stockQuantity,
          stockUnitCost: this.maskPickerCostByRole(user, stockUnitCost),
          stockLocation,
          stockCritical,
        };
      }),
      total,
      page,
      pageSize,
    };
  }

  async findOne(id: string, user: any) {
    const item = await this.prisma.inventoryItem.findFirst({
      where: { id, tenantId: user.tenantId },
      include: {
        itemCategory: { select: ITEM_CATEGORY_SELECT },
        unitOfMeasure: { select: UOM_SELECT },
        inventorySupplier: { select: { id: true, name: true } },
      },
    });
    if (!item) throw new NotFoundException('Artículo no encontrado');
    return item;
  }

  /**
   * PDF de etiqueta térmica con QR (URL al detalle en la webapp o JSON { id, sku }).
   */
  async getItemLabelPdf(
    id: string,
    user: any,
    options: { qr: InventoryLabelQrMode; size: InventoryLabelSize },
  ): Promise<{ stream: Readable; filename: string }> {
    const item = await this.prisma.inventoryItem.findFirst({
      where: { id, tenantId: user.tenantId },
      select: {
        id: true,
        inventoryCode: true,
        partNumber: true,
        name: true,
      },
    });
    if (!item) throw new NotFoundException('Artículo no encontrado');

    const frontendRaw = this.config.get<string>('FRONTEND_URL')?.trim() || '';
    const base = frontendRaw.replace(/\/$/, '');

    let qrPayload: string;
    if (options.qr === 'json') {
      qrPayload = JSON.stringify({
        id: item.id,
        sku: item.inventoryCode ?? '',
      });
    } else if (base) {
      qrPayload = `${base}/app/articulos/${item.id}`;
    } else {
      qrPayload = JSON.stringify({
        id: item.id,
        sku: item.inventoryCode ?? '',
      });
    }

    const buffer = await generateInventoryItemLabelPdfBuffer({
      inventoryCode: item.inventoryCode,
      partNumber: item.partNumber,
      name: item.name,
      qrPayload,
      size: options.size,
    });

    const safeSku =
      item.inventoryCode?.replace(/[^\w.-]+/g, '_') || item.id.slice(0, 8);
    const filename = `etiqueta-${safeSku}.pdf`;

    return {
      stream: Readable.from(buffer),
      filename,
    };
  }

  /**
   * Usuarios con opt-in EMAIL para `INVENTORY_ITEM_CREATED` (panel de gobernanza).
   */
  private async resolveInventoryItemCreatedEmailRecipientIds(
    tenantId: string,
  ): Promise<string[]> {
    const rows = await this.prisma.userNotificationSetting.findMany({
      where: {
        tenantId,
        eventKey: NOTIFICATION_EVENTS.INVENTORY_ITEM_CREATED,
        channel: NotificationChannel.EMAIL,
        enabled: true,
        user: { isActive: true },
      },
      select: { userId: true },
    });
    return [...new Set(rows.map((r) => r.userId))];
  }

  /**
   * Evento `INVENTORY_ITEM_CREATED` (dispatcher: opt-in EMAIL + ccEmails). Fire-and-forget.
   * Paridad entre alta maestro (`create`) y quick-create desde el picker.
   */
  private dispatchInventoryItemCreatedMail(
    user: { tenantId: string; name?: string; email?: string },
    createdItem: {
      id: string;
      inventoryCode: string | null;
      name: string;
      partNumber: string | null;
      itemCategory?: unknown;
    },
  ): void {
    const tenantId = user.tenantId;
    const appUrl = this.config.get<string>('FRONTEND_URL') ?? '';
    const cat = createdItem.itemCategory as
      | {
          name?: string;
          parentCategoryId?: string | null;
          parentCategory?: { name?: string } | null;
        }
      | null
      | undefined;
    const familyName: string = cat?.parentCategory?.name ?? cat?.name ?? '';
    const subfamilyName: string = cat?.parentCategoryId ? (cat?.name ?? '') : '';
    const createdAtFormatted = new Date().toLocaleString('es-CL', {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone: 'America/Santiago',
    });

    const subject = `Nuevo artículo en catálogo: ${createdItem.inventoryCode ?? ''} — ${createdItem.name}`;
    const html = buildMailInventoryItemCreated({
      itemId: createdItem.id,
      inventoryCode: createdItem.inventoryCode ?? '',
      name: createdItem.name,
      familyName,
      subfamilyName: subfamilyName || familyName,
      createdBy: user.name ?? user.email ?? 'Sistema',
      createdAt: createdAtFormatted,
      appUrl,
      partNumber: createdItem.partNumber,
    });

    void this.resolveInventoryItemCreatedEmailRecipientIds(tenantId)
      .then((userIds) =>
        this.notificationDispatcher.dispatch(
          NOTIFICATION_EVENTS.INVENTORY_ITEM_CREATED,
          tenantId,
          { userIds, subject, html },
        ),
      )
      .catch(() => {
        /* fallo en notificación no debe interrumpir la respuesta */
      });
  }

  async create(dto: CreateInventoryItemDto, user: any) {
    if (!dto.categoryId?.trim()) {
      throw new BadRequestException(
        'Debe seleccionar familia y subcategoría para el artículo.',
      );
    }
    if (!dto.unitOfMeasureId?.trim()) {
      throw new BadRequestException('Debe indicar la unidad de medida.');
    }
    await this.assertLeafCategory(dto.categoryId, user.tenantId);
    await this.assertUnitOfMeasure(dto.unitOfMeasureId, user.tenantId);

    const pn = dto.partNumber?.trim() || null;
    if (pn) {
      const existingPn = await this.prisma.inventoryItem.findFirst({
        where: { tenantId: user.tenantId, partNumber: pn },
        select: { id: true },
      });
      if (existingPn) {
        throw new BadRequestException(
          'Ya existe un artículo con este Número de Parte.',
        );
      }
    }

    if (dto.inventoryCode?.trim()) {
      throw new BadRequestException(
        'El código de inventario lo asigna el sistema; no envíe "inventoryCode" al crear el artículo.',
      );
    }

    const createdItem = await this.prisma.$transaction(async (tx) => {
      await this.ensureInventorySkuCounterFloor(user.tenantId, tx);
      const inventoryCode = await this.sequenceService.getNextCorrelative(
        user.tenantId,
        INV_SKU_DOC_TYPE,
        INV_SKU_PREFIX,
        {
          tx,
          padWidth: 4,
          separator: '',
        },
      );

      const id = randomUUID();
      const qrCode = `INV:${id}`;

      let policyExtra: {
        policyTargetWarehouseId: string;
        policyMinStock: number;
        policyMaxStock: number;
      } | null = null;

      const wh = dto.warehouseId?.trim();
      if (wh) {
        if (
          dto.minStock === undefined ||
          dto.minStock === null ||
          dto.maxStock === undefined ||
          dto.maxStock === null
        ) {
          throw new BadRequestException(
            'Si indica una bodega inicial, debe enviar stock mínimo y stock máximo (números ≥ 0).',
          );
        }
        const minStock = Number(dto.minStock);
        const maxStock = Number(dto.maxStock);
        if (!Number.isFinite(minStock) || minStock < 0) {
          throw new BadRequestException(
            'El stock mínimo debe ser un número mayor o igual a cero.',
          );
        }
        if (!Number.isFinite(maxStock) || maxStock < 0) {
          throw new BadRequestException(
            'El stock máximo debe ser un número mayor o igual a cero.',
          );
        }
        if (maxStock > 0 && maxStock < minStock) {
          throw new BadRequestException(
            'El stock máximo no puede ser menor que el stock mínimo.',
          );
        }
        const warehouse = await tx.warehouse.findFirst({
          where: { id: wh, tenantId: user.tenantId },
          select: { id: true },
        });
        if (!warehouse) {
          throw new BadRequestException(
            'La bodega seleccionada no existe o no pertenece a su empresa.',
          );
        }
        policyExtra = {
          policyTargetWarehouseId: warehouse.id,
          policyMinStock: minStock,
          policyMaxStock: maxStock,
        };
      }

      const item = await tx.inventoryItem.create({
        data: {
          id,
          qrCode,
          tenantId: user.tenantId,
          inventoryCode,
          partNumber: pn,
          name: dto.name,
          description: dto.description,
          categoryId: dto.categoryId,
          unitOfMeasureId: dto.unitOfMeasureId,
          brand: dto.brand,
          supplierId: dto.supplierId ?? null,
          isSerialized: dto.isSerialized ?? false,
          isInventory: dto.isInventory ?? true,
          isAsset: dto.isAsset ?? false,
          isConsumable: dto.isConsumable ?? true,
          compatibilityInfo: dto.compatibilityInfo?.trim() || null,
          ...(policyExtra ?? {}),
        },
        include: {
          itemCategory: { select: ITEM_CATEGORY_SELECT },
          unitOfMeasure: { select: UOM_SELECT },
          inventorySupplier: { select: { id: true, name: true } },
        },
      });

      return item;
    });

    // ── Auditoría: génesis del artículo en el historial ──────────────────────
    await this.audit.log({
      userId: user.id,
      tenantId: user.tenantId,
      entityType: 'INVENTORY_ITEM',
      entityId: createdItem.id,
      action: 'CREATE',
      newValue: {
        inventoryCode: createdItem.inventoryCode,
        name: createdItem.name,
        categoryId: createdItem.categoryId,
        unitOfMeasureId: createdItem.unitOfMeasureId,
        partNumber: createdItem.partNumber ?? null,
        isSerialized: createdItem.isSerialized,
        isInventory: createdItem.isInventory,
        isAsset: createdItem.isAsset,
        isConsumable: createdItem.isConsumable,
      },
    });

    // userIds vacío → solo llegarán correos a los ccEmails configurados en la UI.
    this.dispatchInventoryItemCreatedMail(user, createdItem);

    return createdItem;
  }

  async update(id: string, dto: UpdateInventoryItemDto, user: any) {
    const existing = await this.findOne(id, user);
    if (dto.inventoryCode !== undefined) {
      const incoming = (dto.inventoryCode ?? '').trim();
      const current = (existing.inventoryCode ?? '').trim();
      if (incoming !== current) {
        throw new BadRequestException(
          'El código de inventario no se puede modificar.',
        );
      }
    }
    const merged: CreateInventoryItemDto = {
      partNumber:
        dto.partNumber !== undefined
          ? dto.partNumber
          : (existing.partNumber ?? undefined),
      supplierId:
        dto.supplierId !== undefined
          ? dto.supplierId
          : ((existing as any).supplierId ?? undefined),
      name: dto.name ?? existing.name,
      description:
        dto.description !== undefined
          ? dto.description
          : (existing.description ?? undefined),
      categoryId: dto.categoryId ?? existing.categoryId,
      unitOfMeasureId: dto.unitOfMeasureId ?? existing.unitOfMeasureId,
      brand:
        dto.brand !== undefined ? dto.brand : (existing.brand ?? undefined),
      compatibilityInfo:
        dto.compatibilityInfo !== undefined
          ? dto.compatibilityInfo
          : (existing.compatibilityInfo ?? undefined),
      isSerialized: dto.isSerialized ?? existing.isSerialized,
      isInventory: dto.isInventory ?? existing.isInventory,
      isAsset: dto.isAsset ?? existing.isAsset,
      isConsumable: dto.isConsumable ?? existing.isConsumable,
    };

    if (!merged.categoryId?.trim()) {
      throw new BadRequestException(
        'Debe seleccionar familia y subcategoría para el artículo.',
      );
    }
    if (!merged.unitOfMeasureId?.trim()) {
      throw new BadRequestException('Debe indicar la unidad de medida.');
    }
    await this.assertLeafCategory(merged.categoryId, user.tenantId);
    await this.assertUnitOfMeasure(merged.unitOfMeasureId, user.tenantId);

    const mergedPn = merged.partNumber?.trim() || null;
    if (mergedPn) {
      const existingPn = await this.prisma.inventoryItem.findFirst({
        where: { tenantId: user.tenantId, partNumber: mergedPn, id: { not: id } },
        select: { id: true },
      });
      if (existingPn) {
        throw new BadRequestException(
          'El Número de Parte ya está siendo usado por otro artículo.',
        );
      }
    }

    return this.prisma.inventoryItem.update({
      where: { id },
      data: {
        partNumber: mergedPn,
        name: merged.name,
        description: merged.description,
        categoryId: merged.categoryId,
        unitOfMeasureId: merged.unitOfMeasureId,
        brand: merged.brand,
        supplierId: merged.supplierId ?? null,
        isSerialized: merged.isSerialized ?? false,
        isInventory: merged.isInventory ?? true,
        isAsset: merged.isAsset ?? false,
        isConsumable: merged.isConsumable ?? true,
        compatibilityInfo: merged.compatibilityInfo?.trim() || null,
      },
      include: {
        itemCategory: { select: ITEM_CATEGORY_SELECT },
        unitOfMeasure: { select: UOM_SELECT },
        inventorySupplier: { select: { id: true, name: true } },
      },
    });
  }

  async quickCreate(dto: QuickCreateItemDto, user: any) {
    if (!dto.categoryId?.trim()) {
      throw new BadRequestException(
        'Seleccione familia y subcategoría antes de crear el artículo.',
      );
    }
    if (!dto.unitOfMeasureId?.trim()) {
      throw new BadRequestException('Seleccione la unidad de medida.');
    }

    const name = dto.name.trim();
    if (!name) {
      throw new BadRequestException('El nombre del artículo es obligatorio.');
    }
    if (name.length > 150) {
      throw new BadRequestException(
        'El nombre no puede superar 150 caracteres.',
      );
    }

    const requestedPn = dto.partNumber?.trim() ?? '';
    if (requestedPn.length > 50) {
      throw new BadRequestException(
        'El Número de Parte no puede superar 50 caracteres.',
      );
    }
    if (dto.inventoryCode?.trim()) {
      throw new BadRequestException(
        'El código de inventario lo asigna el sistema; no envíe "inventoryCode" en quick-create.',
      );
    }
    const brand = dto.brand?.trim() || undefined;
    if (brand && brand.length > 50) {
      throw new BadRequestException('La marca no puede superar 50 caracteres.');
    }
    const description = dto.description?.trim() || undefined;
    const compatibilityInfo = dto.compatibilityInfo?.trim() || undefined;

    if (requestedPn) {
      const existingPn = await this.prisma.inventoryItem.findUnique({
        where: {
          tenantId_partNumber: {
            tenantId: user.tenantId,
            partNumber: requestedPn,
          },
        },
      });
      if (existingPn) {
        throw new BadRequestException(
          'Ya existe un artículo con este Número de Parte.',
        );
      }
    }
    const isSerialized = dto.isSerialized ?? false;
    const isInventory = dto.isInventory ?? true;
    const isAsset = dto.isAsset ?? false;
    const isConsumable = dto.isConsumable ?? true;

    const createdItem = await this.prisma.$transaction(
      async (tx) => {
        await this.assertLeafCategoryWithTx(tx, dto.categoryId, user.tenantId);
        await this.assertUnitOfMeasureTx(
          tx,
          dto.unitOfMeasureId,
          user.tenantId,
        );

        await this.ensureInventorySkuCounterFloor(user.tenantId, tx);

        const partNumber = requestedPn ? requestedPn : null;
        const inventoryCode = await this.sequenceService.getNextCorrelative(
          user.tenantId,
          INV_SKU_DOC_TYPE,
          INV_SKU_PREFIX,
          {
            tx,
            padWidth: 4,
            separator: '',
          },
        );

        const id = randomUUID();
        const qrCode = `INV:${id}`;

        let policyExtra: {
          policyTargetWarehouseId: string;
          policyMinStock: number;
          policyMaxStock: number;
        } | null = null;

        if (dto.warehouseId?.trim()) {
          const wh = dto.warehouseId.trim();
          const minStock =
            dto.minStock !== undefined && dto.minStock !== null
              ? Number(dto.minStock)
              : 0;
          const maxStock =
            dto.maxStock !== undefined && dto.maxStock !== null
              ? Number(dto.maxStock)
              : 0;
          if (!Number.isFinite(minStock) || minStock < 0) {
            throw new BadRequestException(
              'El stock mínimo debe ser un número mayor o igual a cero.',
            );
          }
          if (!Number.isFinite(maxStock) || maxStock < 0) {
            throw new BadRequestException(
              'El stock máximo debe ser un número mayor o igual a cero.',
            );
          }
          if (maxStock > 0 && maxStock < minStock) {
            throw new BadRequestException(
              'El stock máximo no puede ser menor que el stock mínimo.',
            );
          }
          const warehouse = await tx.warehouse.findFirst({
            where: { id: wh, tenantId: user.tenantId },
            select: { id: true },
          });
          if (!warehouse) {
            throw new BadRequestException(
              'La bodega seleccionada no existe o no pertenece a su empresa.',
            );
          }
          policyExtra = {
            policyTargetWarehouseId: warehouse.id,
            policyMinStock: minStock,
            policyMaxStock: maxStock,
          };
        }

        const item = await tx.inventoryItem.create({
          data: {
            id,
            qrCode,
            tenantId: user.tenantId,
            inventoryCode,
            partNumber,
            name,
            description: description ?? null,
            categoryId: dto.categoryId,
            unitOfMeasureId: dto.unitOfMeasureId,
            brand: brand ?? null,
            compatibilityInfo: compatibilityInfo ?? null,
            isSerialized,
            isInventory,
            isAsset,
            isConsumable,
            ...(policyExtra ?? {}),
          },
          select: {
            id: true,
            qrCode: true,
            inventoryCode: true,
            partNumber: true,
            name: true,
            categoryId: true,
            unitOfMeasure: { select: UOM_SELECT },
            itemCategory: { select: ITEM_CATEGORY_SELECT },
          },
        });

        return item;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10_000,
        timeout: 30_000,
      },
    );

    this.dispatchInventoryItemCreatedMail(user, createdItem);

    return createdItem;
  }

  private async assertLeafCategoryWithTx(
    tx: Prisma.TransactionClient,
    categoryId: string,
    tenantId: string,
  ) {
    const cat = await tx.itemCategory.findFirst({
      where: { id: categoryId, tenantId },
    });
    if (!cat) {
      throw new BadRequestException(
        'La categoría no existe o no pertenece a su empresa.',
      );
    }
    if (!cat.parentCategoryId) {
      throw new BadRequestException(
        'Debe seleccionar una subcategoría (no una familia de nivel superior).',
      );
    }
    const parent = await tx.itemCategory.findFirst({
      where: { id: cat.parentCategoryId, tenantId },
    });
    if (!parent) {
      throw new BadRequestException(
        'La familia de la subcategoría no existe o no pertenece a su empresa.',
      );
    }
    if (parent.parentCategoryId) {
      throw new BadRequestException(
        'Solo se permiten dos niveles: familia y subcategoría.',
      );
    }
  }

  /**
   * Kardex: movimientos de inventario del artículo (paginado), con referencia a OC/OT cuando aplica.
   */
  async findItemLedger(
    itemId: string,
    user: any,
    opts: { page?: number; pageSize?: number; warehouseId?: string },
  ) {
    const tenantId = user.tenantId as string;
    const exists = await this.prisma.inventoryItem.findFirst({
      where: { id: itemId, tenantId },
      select: { id: true },
    });
    if (!exists) {
      throw new NotFoundException('Artículo no encontrado');
    }

    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 25));
    const skip = (page - 1) * pageSize;
    const where: Prisma.InventoryTransactionWhereInput = { itemId };
    const whId = opts.warehouseId?.trim();
    if (whId) {
      const wh = await this.prisma.warehouse.findFirst({
        where: { id: whId, tenantId },
        select: { id: true },
      });
      if (!wh) {
        throw new BadRequestException('Bodega no válida para el historial.');
      }
      where.warehouseId = whId;
    }

    const [rows, total] = await Promise.all([
      this.prisma.inventoryTransaction.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { date: 'desc' },
        include: {
          warehouse: { select: { id: true, code: true, name: true } },
          user: { select: { id: true, name: true } },
        },
      }),
      this.prisma.inventoryTransaction.count({ where }),
    ]);

    const woIds = [
      ...new Set(
        rows
          .filter(
            (r) =>
              r.referenceType === 'WORK_ORDER' &&
              r.referenceId &&
              r.referenceId.length > 0,
          )
          .map((r) => r.referenceId as string),
      ),
    ];
    const wrIds = [
      ...new Set(
        rows
          .filter(
            (r) =>
              r.referenceType === 'PURCHASE_RECEIPT' &&
              r.referenceId &&
              r.referenceId.length > 0,
          )
          .map((r) => r.referenceId as string),
      ),
    ];
    const trfIds = [
      ...new Set(
        rows
          .filter(
            (r) =>
              r.referenceType === 'INVENTORY_TRANSFER' &&
              r.referenceId &&
              r.referenceId.length > 0,
          )
          .map((r) => r.referenceId as string),
      ),
    ];

    const [wos, wrs, transfers] = await Promise.all([
      woIds.length
        ? this.prisma.workOrder.findMany({
            where: { id: { in: woIds }, tenantId },
            select: { id: true, correlative: true },
          })
        : [],
      wrIds.length
        ? this.prisma.warehouseReceipt.findMany({
            where: { id: { in: wrIds }, tenantId },
            select: {
              id: true,
              correlative: true,
              purchaseOrderId: true,
              purchaseOrder: {
                select: { id: true, correlative: true },
              },
            },
          })
        : [],
      trfIds.length
        ? this.prisma.inventoryTransfer.findMany({
            where: { id: { in: trfIds }, tenantId },
            select: {
              id: true,
              originWarehouseId: true,
              destinationWarehouseId: true,
              originWarehouse: { select: { code: true, name: true } },
              destinationWarehouse: { select: { code: true, name: true } },
            },
          })
        : [],
    ]);

    const woMap = new Map(wos.map((w) => [w.id, w.correlative]));
    const wrMap = new Map(
      wrs.map((w) => [
        w.id,
        {
          correlative: w.correlative,
          purchaseOrderId: w.purchaseOrderId,
          poCorrelative: w.purchaseOrder?.correlative ?? null,
        },
      ]),
    );

    const trfMap = new Map(
      transfers.map((t) => [
        t.id,
        {
          originWarehouseId: t.originWarehouseId,
          destinationWarehouseId: t.destinationWarehouseId,
          originCode: t.originWarehouse.code,
          destCode: t.destinationWarehouse.code,
          originName: t.originWarehouse.name,
          destName: t.destinationWarehouse.name,
        },
      ]),
    );

    const data = rows.map((r) => {
      let reference: {
        kind: string;
        label: string;
        workOrderId?: string;
        warehouseReceiptId?: string;
        purchaseOrderId?: string;
        purchaseOrderCorrelative?: string;
        transferId?: string;
      } | null = null;
      if (r.referenceId && r.referenceType) {
        if (r.referenceType === 'WORK_ORDER') {
          const cor = woMap.get(r.referenceId);
          reference = {
            kind: 'WORK_ORDER',
            label: cor ? `OT ${cor}` : 'Orden de trabajo',
            workOrderId: r.referenceId,
          };
        } else if (r.referenceType === 'PURCHASE_RECEIPT') {
          const wr = wrMap.get(r.referenceId);
          if (r.type === 'ADJUST') {
            reference = {
              kind: 'ADJUST_SALDO_PENDIENTE',
              label: wr
                ? `Saldo pendiente · recepción ${wr.correlative}${wr.poCorrelative ? ` (OC ${wr.poCorrelative})` : ''}`
                : 'Ajuste saldo pendiente (recepción)',
              warehouseReceiptId: r.referenceId,
              purchaseOrderId: wr?.purchaseOrderId,
              purchaseOrderCorrelative: wr?.poCorrelative ?? undefined,
            };
          } else {
            reference = {
              kind: 'PURCHASE_RECEIPT',
              label: wr
                ? `Recepción ${wr.correlative}${wr.poCorrelative ? ` (OC ${wr.poCorrelative})` : ''}`
                : 'Recepción de compra',
              warehouseReceiptId: r.referenceId,
              purchaseOrderId: wr?.purchaseOrderId,
              purchaseOrderCorrelative: wr?.poCorrelative ?? undefined,
            };
          }
        } else if (r.referenceType === 'INVENTORY_TRANSFER') {
          const tr = trfMap.get(r.referenceId);
          let label = 'Transferencia entre bodegas (W2W)';
          if (tr) {
            if (r.type === 'TRANSFER_OUT') {
              label = `Salida por transferencia → ${tr.destCode} · ${tr.destName}`;
            } else if (r.type === 'TRANSFER_IN') {
              label = `Entrada por transferencia ← ${tr.originCode} · ${tr.originName}`;
            } else {
              label = `Transferencia W2W · ${tr.originCode} → ${tr.destCode}`;
            }
          }
          reference = {
            kind: 'INVENTORY_TRANSFER',
            label,
            transferId: r.referenceId,
          };
        } else if (r.referenceType === 'INVENTORY_ADJUSTMENT') {
          reference = {
            kind: 'INVENTORY_ADJUSTMENT',
            label: 'Ajuste de inventario',
          };
        } else {
          reference = {
            kind: r.referenceType,
            label: r.notes?.slice(0, 120) || r.referenceType,
          };
        }
      }

      return {
        id: r.id,
        date: r.date.toISOString(),
        type: r.type,
        quantity: r.quantity,
        previousStock: r.previousStock,
        newStock: r.newStock,
        notes: r.notes,
        isPendingRegularization: r.isPendingRegularization,
        referenceType: r.referenceType,
        warehouse: r.warehouse,
        user: r.user,
        reference,
      };
    });

    /**
     * Fila sintética de Génesis: consulta el primer registro de auditoría
     * `CREATE / INVENTORY_ITEM` y lo inyecta al final de la última página
     * del ledger. No tiene warehouse real ni referencia, ya que es un hito
     * de catálogo, no una transacción física de stock.
     */
    const genesisLog = await this.prisma.activityLog.findFirst({
      where: {
        entityId: itemId,
        entityType: 'INVENTORY_ITEM',
        action: 'CREATE',
      },
      include: { user: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'asc' },
    });

    const adjustedTotal = total + (genesisLog ? 1 : 0);
    const isLastPage = skip + rows.length >= total;
    type LedgerRow = (typeof data)[number];
    const finalData: LedgerRow[] = [...data];

    if (genesisLog && isLastPage) {
      finalData.push({
        id: genesisLog.id,
        date: genesisLog.createdAt.toISOString(),
        // 'ITEM_GENESIS' es un tipo sintético fuera del enum TransactionType de Prisma;
        // se castea como unknown para que el frontend lo trate como string discriminante.
        type: 'ITEM_GENESIS' as unknown as LedgerRow['type'],
        quantity: 0,
        previousStock: 0,
        newStock: 0,
        notes: 'Alta en catálogo maestro',
        isPendingRegularization: false,
        referenceType: null,
        warehouse: { id: '', code: '—', name: 'Catálogo maestro' },
        user: { id: genesisLog.userId, name: genesisLog.user.name },
        reference: null,
      });
    }

    return { data: finalData, total: adjustedTotal, page, pageSize };
  }

  async search(user: any, q: string) {
    if (!q || q.trim().length < 2) return [];

    const tenantId = user.tenantId;
    const searchIds = await this.searchInventoryItemIdsPgTrgm(tenantId, q);
    if (searchIds.length === 0) return [];

    const pageIds = searchIds.slice(0, 15);
    const where = await this.buildInventoryItemWhere(tenantId, {
      searchIds: pageIds,
    });

    const rows = await this.prisma.inventoryItem.findMany({
      where,
      select: {
        id: true,
        inventoryCode: true,
        partNumber: true,
        name: true,
        unitOfMeasure: { select: UOM_SELECT },
        categoryId: true,
        itemCategory: { select: ITEM_CATEGORY_SELECT },
        brand: true,
        compatibilityInfo: true,
        isInventory: true,
        isAsset: true,
        isConsumable: true,
      },
    });
    return this.sortRowsBySearchIdOrder(rows, pageIds);
  }

  async remove(id: string, user: any) {
    await this.findOne(id, user);

    try {
      return await this.prisma.inventoryItem.delete({
        where: { id },
      });
    } catch (error) {
      throw new BadRequestException(
        'No se puede eliminar el artículo porque ya tiene historial de stock o transacciones en bodegas.',
      );
    }
  }

  async listAttachments(itemId: string, user: any) {
    const tenantId = user.tenantId as string;
    const item = await this.prisma.inventoryItem.findFirst({
      where: { id: itemId, tenantId },
      select: { id: true },
    });
    if (!item) throw new NotFoundException('Artículo no encontrado');

    const rows = await this.prisma.inventoryItemAttachment.findMany({
      where: { itemId, tenantId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        fileName: true,
        mimeType: true,
        storageKey: true,
        sizeBytes: true,
        createdAt: true,
        uploadedBy: { select: { id: true, name: true } },
      },
    });

    return Promise.all(
      rows.map(async (row) => ({
        id: row.id,
        fileName: row.fileName,
        mimeType: row.mimeType,
        sizeBytes: row.sizeBytes,
        createdAt: row.createdAt.toISOString(),
        uploadedBy: row.uploadedBy,
        url: await this.storageService.getReadOnlyUrl(row.storageKey),
      })),
    );
  }

  async addAttachment(
    itemId: string,
    file: {
      buffer: Buffer;
      originalname: string;
      mimetype: string;
      size: number;
    },
    user: any,
  ) {
    const tenantId = user.tenantId as string;
    const userId = user.id || user.sub;
    if (!userId) {
      throw new BadRequestException('Usuario no identificado.');
    }

    const item = await this.prisma.inventoryItem.findFirst({
      where: { id: itemId, tenantId },
      select: { id: true },
    });
    if (!item) throw new NotFoundException('Artículo no encontrado');

    const mt = file.mimetype?.toLowerCase() ?? '';
    if (!mt.includes('pdf')) {
      throw new BadRequestException('Solo se permiten archivos PDF.');
    }

    const storageKey = await this.storageService.uploadFile(
      file,
      'inventory-item-docs',
    );

    const row = await this.prisma.inventoryItemAttachment.create({
      data: {
        tenantId,
        itemId,
        fileName: file.originalname.slice(0, 250),
        storageKey,
        mimeType: file.mimetype.slice(0, 120),
        sizeBytes: file.size,
        uploadedById: userId,
      },
      select: {
        id: true,
        fileName: true,
        mimeType: true,
        storageKey: true,
        sizeBytes: true,
        createdAt: true,
        uploadedBy: { select: { id: true, name: true } },
      },
    });

    return {
      id: row.id,
      fileName: row.fileName,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
      createdAt: row.createdAt.toISOString(),
      uploadedBy: row.uploadedBy,
      url: await this.storageService.getReadOnlyUrl(row.storageKey),
    };
  }

  async removeAttachment(itemId: string, attachmentId: string, user: any) {
    const tenantId = user.tenantId as string;
    const att = await this.prisma.inventoryItemAttachment.findFirst({
      where: { id: attachmentId, itemId, tenantId },
    });
    if (!att) throw new NotFoundException('Adjunto no encontrado');

    await this.storageService.deleteFile(att.storageKey);
    await this.prisma.inventoryItemAttachment.delete({
      where: { id: attachmentId },
    });
    return { ok: true };
  }
}
