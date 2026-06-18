import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { NotificationChannel, Prisma, TransactionType } from '@prisma/client';
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
import { generateInventoryMasterExcelBuffer } from './inventory-master-excel.generator';
import {
  getImportNullableString,
  getImportString,
  normalizeImportKey,
  normalizeImportText,
  parseBaseLogicMasterImportWorkbook,
  parseImportBoolean,
  parseImportNumber,
} from '../../common/excel/baselogic-master-import.util';
import { listItemIdsWithFieldDispatchOutstanding } from '../../common/inventory/field-dispatch-outstanding';
import { NotificationDispatcherService } from '../../common/notifications/notification-dispatcher.service';
import { NOTIFICATION_EVENTS } from '../../common/notifications/notification-events';
import { buildMailInventoryItemCreated } from '../../common/email/transactional-mail.builder';
import { AuditService } from '../../common/audit/audit.service';
import { userCanViewInventoryCost } from '../auth/permissions.util';
import {
  buildPurchaseContractScopeFilter,
  userCanAccessContractId,
} from '../../common/contract-scope.util';

type InventoryImportRequirement = {
  kind: 'CATEGORY' | 'UNIT' | 'WAREHOUSE' | 'BIN' | 'SUPPLIER';
  code: string;
  parentCode?: string | null;
  rows: number[];
  severity: 'blocking' | 'warning';
  message: string;
};

type InventoryImportAction = 'CREATE' | 'UPDATE' | 'NO_CHANGE' | 'ERROR';

type InventoryImportPreviewRow = {
  rowNumber: number;
  action: InventoryImportAction;
  itemId: string | null;
  inventoryCode: string | null;
  partNumber: string | null;
  warehouseCode: string | null;
  label: string;
  errors: string[];
  warnings: string[];
  changes: Array<{ field: string; before: unknown; after: unknown }>;
};

type InventoryImportImpact = {
  stocks: number;
  transactions: number;
  reservations: number;
  workOrderParts: number;
  lubeReportLines: number;
  transferLines: number;
  requisitionItems: number;
  purchaseOrderItems: number;
  attachments: number;
};

type InventoryDeleteCandidate = {
  itemId: string;
  inventoryCode: string | null;
  partNumber: string | null;
  name: string;
  impact: InventoryImportImpact;
  warnings: string[];
};

type InventoryImportOptions = {
  allowCreates?: boolean;
  allowUpdates?: boolean;
  allowStockAdjustments?: boolean;
  allowItemDeletes?: boolean;
  autoCreateBins?: boolean;
  autoCreateSuppliers?: boolean;
};

const INV_SKU_DOC_TYPE = 'INV_SKU';
/** Prefijo código de inventario autogenerado: `IN` + 4 dígitos (p. ej. IN0042). */
const INV_SKU_PREFIX = 'IN';

/** UUID v1–v5 (Prisma / `randomUUID()` usan v4; aceptamos el formato estándar). */
const UUID_PARAM_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

function boolLabel(value: boolean): string {
  return value ? 'SI' : 'NO';
}

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

  private isInventoryItemUuidParam(value: string): boolean {
    return UUID_PARAM_RE.test(value.trim());
  }

  /**
   * Resuelve `:id` de rutas HTTP: UUID del registro o **código de inventario** único por tenant (`IN####`).
   * Evita `P2007` en Postgres cuando el cliente envía el SKU en lugar del UUID.
   */
  private async resolveInventoryItemRecordId(
    idOrCode: string,
    tenantId: string,
  ): Promise<string> {
    const raw = idOrCode.trim();
    if (!raw) {
      throw new BadRequestException('Identificador de artículo requerido.');
    }
    if (this.isInventoryItemUuidParam(raw)) {
      return raw;
    }
    const row = await this.prisma.inventoryItem.findFirst({
      where: { tenantId, inventoryCode: raw },
      select: { id: true },
    });
    if (!row) {
      throw new NotFoundException('Artículo no encontrado');
    }
    return row.id;
  }

  private duplicatePartNumberMessage(existing: {
    inventoryCode: string | null;
    name: string;
  }): string {
    const code =
      (existing.inventoryCode ?? '').trim() || 'sin código de inventario';
    return `Ya existe un artículo con este Número de Parte: ${code} — ${existing.name}.`;
  }

  /** Mapea violación única de `part_number` (carrera entre requests) a 400 legible. */
  private async rethrowIfPartNumberUniqueViolation(
    e: unknown,
    tenantId: string,
    partNumber: string | null,
  ): Promise<void> {
    if (
      !partNumber ||
      !(e instanceof Prisma.PrismaClientKnownRequestError) ||
      e.code !== 'P2002'
    ) {
      return;
    }
    const target = e.meta?.target;
    const parts = Array.isArray(target)
      ? (target as string[])
      : typeof target === 'string'
        ? [target]
        : [];
    const hitsPartNumber = parts.some(
      (t) =>
        typeof t === 'string' &&
        (t.includes('part_number') || t.includes('partNumber')),
    );
    if (!hitsPartNumber && parts.length > 0) {
      return;
    }
    const row = await this.prisma.inventoryItem.findFirst({
      where: { tenantId, partNumber },
      select: { inventoryCode: true, name: true },
    });
    if (row) {
      throw new BadRequestException(this.duplicatePartNumberMessage(row));
    }
  }

  private maskPickerCostByRole(
    user: { role?: string; permissions?: string[] } | null | undefined,
    value: number | null,
  ): number | null {
    if (userCanViewInventoryCost(user)) return value;
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
      if (mNew) floor = Math.max(floor, parseInt(mNew[1], 10));
      const mOld = /^INV-(\d{1,8})$/i.exec(t);
      if (mOld) floor = Math.max(floor, parseInt(mOld[1], 10));
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

  async getInventoryMasterExcelBuffer(user: any): Promise<Buffer> {
    const tenantId = user.tenantId as string;
    const canViewCost = userCanViewInventoryCost(user);
    const warehouseScopeWhere = this.warehouseContractScopeWhere(user);

    const [tenant, items, categories, units, warehouses, suppliers] =
      await this.prisma.$transaction([
        this.prisma.tenant.findUnique({
          where: { id: tenantId },
          select: { name: true },
        }),
        this.prisma.inventoryItem.findMany({
          where: { tenantId },
          orderBy: ITEM_CATALOG_ORDER_BY,
          include: {
            itemCategory: {
              select: {
                name: true,
                parentCategory: { select: { name: true } },
              },
            },
            unitOfMeasure: {
              select: {
                name: true,
                abbreviation: true,
                allowsDecimals: true,
              },
            },
            inventorySupplier: { select: { name: true } },
            policyTargetWarehouse: { select: { code: true, name: true } },
            stocks: {
              where: { warehouse: warehouseScopeWhere },
              orderBy: { warehouse: { code: 'asc' } },
              select: {
                quantity: true,
                unitCost: true,
                minStock: true,
                maxStock: true,
                location: true,
                bin: { select: { code: true, label: true } },
                warehouse: {
                  select: {
                    code: true,
                    name: true,
                    location: true,
                    contract: { select: { code: true, name: true } },
                    subcontract: { select: { code: true, name: true } },
                  },
                },
              },
            },
          },
        }),
        this.prisma.itemCategory.findMany({
          where: { tenantId },
          orderBy: [{ parentCategory: { name: 'asc' } }, { name: 'asc' }],
          select: {
            name: true,
            parentCategory: { select: { name: true } },
          },
        }),
        this.prisma.unitOfMeasure.findMany({
          where: { tenantId },
          orderBy: { abbreviation: 'asc' },
          select: { name: true, abbreviation: true, allowsDecimals: true },
        }),
        this.prisma.warehouse.findMany({
          where: warehouseScopeWhere,
          orderBy: { code: 'asc' },
          select: {
            code: true,
            name: true,
            location: true,
            contract: { select: { code: true, name: true } },
            subcontract: { select: { code: true, name: true } },
          },
        }),
        this.prisma.inventorySupplier.findMany({
          where: { tenantId },
          orderBy: { name: 'asc' },
          select: { name: true },
        }),
      ]);

    return generateInventoryMasterExcelBuffer({
      tenantName: tenant?.name ?? 'BaseLogic TPM',
      generatedAt: new Date(),
      canViewCost,
      items,
      categories: categories.map((category) => ({
        family: category.parentCategory?.name ?? category.name,
        subcategory: category.parentCategory ? category.name : null,
      })),
      units,
      warehouses: warehouses.map((warehouse) => ({
        code: warehouse.code,
        name: warehouse.name,
        location: warehouse.location,
        contractCode: warehouse.contract.code,
        subcontractCode: warehouse.subcontract?.code ?? null,
      })),
      suppliers,
    });
  }

  private registerInventoryRequirement(
    map: Map<string, InventoryImportRequirement>,
    requirement: InventoryImportRequirement,
  ): void {
    const key = `${requirement.kind}:${requirement.parentCode ?? ''}:${requirement.code}`;
    const existing = map.get(key);
    if (existing) {
      existing.rows = [
        ...new Set([...existing.rows, ...requirement.rows]),
      ].sort((a, b) => a - b);
      if (requirement.severity === 'blocking') existing.severity = 'blocking';
      return;
    }
    map.set(key, requirement);
  }

  private async buildInventoryDeleteImpact(
    tenantId: string,
    itemIds: string[],
  ): Promise<Map<string, InventoryImportImpact>> {
    const empty = (): InventoryImportImpact => ({
      stocks: 0,
      transactions: 0,
      reservations: 0,
      workOrderParts: 0,
      lubeReportLines: 0,
      transferLines: 0,
      requisitionItems: 0,
      purchaseOrderItems: 0,
      attachments: 0,
    });
    const map = new Map(itemIds.map((id) => [id, empty()]));
    if (itemIds.length === 0) return map;

    const attach = <K extends keyof InventoryImportImpact>(
      key: K,
      rows: any[],
    ) => {
      for (const row of rows) {
        if (!row.itemId) continue;
        const entry = map.get(row.itemId);
        if (entry) entry[key] = row._count?._all ?? 0;
      }
    };

    const [
      stocks,
      transactions,
      reservations,
      workOrderParts,
      lubeReportLines,
      transferLines,
      requisitionItems,
      purchaseOrderItems,
      attachments,
    ] = await Promise.all([
      this.prisma.itemStock.groupBy({
        by: ['itemId'],
        where: { itemId: { in: itemIds } },
        _count: { _all: true },
      }),
      this.prisma.inventoryTransaction.groupBy({
        by: ['itemId'],
        where: { itemId: { in: itemIds } },
        _count: { _all: true },
      }),
      this.prisma.stockReservation.groupBy({
        by: ['itemId'],
        where: { itemId: { in: itemIds }, warehouse: { tenantId } },
        _count: { _all: true },
      }),
      this.prisma.workOrderPart.groupBy({
        by: ['inventoryItemId'],
        where: { inventoryItemId: { in: itemIds } },
        _count: { _all: true },
      }),
      this.prisma.lubeReportLine.groupBy({
        by: ['itemId'],
        where: { itemId: { in: itemIds } },
        _count: { _all: true },
      }),
      this.prisma.inventoryTransferLine.groupBy({
        by: ['itemId'],
        where: { itemId: { in: itemIds } },
        _count: { _all: true },
      }),
      this.prisma.requisitionItem.groupBy({
        by: ['inventoryItemId'],
        where: { inventoryItemId: { in: itemIds } },
        _count: { _all: true },
      }),
      this.prisma.purchaseOrderItem.groupBy({
        by: ['inventoryItemId'],
        where: { inventoryItemId: { in: itemIds } },
        _count: { _all: true },
      }),
      this.prisma.inventoryItemAttachment.groupBy({
        by: ['itemId'],
        where: { tenantId, itemId: { in: itemIds } },
        _count: { _all: true },
      }),
    ]);

    attach('stocks', stocks);
    attach('transactions', transactions);
    attach('reservations', reservations);
    for (const row of workOrderParts) {
      if (!row.inventoryItemId) continue;
      const entry = map.get(row.inventoryItemId);
      if (entry) entry.workOrderParts = row._count?._all ?? 0;
    }
    attach('lubeReportLines', lubeReportLines);
    attach('transferLines', transferLines);
    for (const row of requisitionItems) {
      if (!row.inventoryItemId) continue;
      const entry = map.get(row.inventoryItemId);
      if (entry) entry.requisitionItems = row._count._all;
    }
    for (const row of purchaseOrderItems) {
      if (!row.inventoryItemId) continue;
      const entry = map.get(row.inventoryItemId);
      if (entry) entry.purchaseOrderItems = row._count._all;
    }
    attach('attachments', attachments);
    return map;
  }

  private hasInventoryDeleteImpact(impact: InventoryImportImpact): boolean {
    return Object.values(impact).some((count) => count > 0);
  }

  private warehouseContractScopeWhere(user: any): Prisma.WarehouseWhereInput {
    return {
      tenantId: user.tenantId as string,
      ...buildPurchaseContractScopeFilter(user),
    };
  }

  private canAccessWarehouseContract(user: any, contractId: string): boolean {
    return userCanAccessContractId(user, contractId);
  }

  private assertCanAccessWarehouseContract(user: any, contractId: string): void {
    if (!this.canAccessWarehouseContract(user, contractId)) {
      throw new ForbiddenException(
        'No tiene permisos para ajustar stock en esta bodega.',
      );
    }
  }

  private normalizeWarehouseBinCode(code: string): string {
    return normalizeImportKey(code)
      .replace(/[^A-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50);
  }

  private isIntegerQuantityAllowed(value: number): boolean {
    return Math.abs(value - Math.round(value)) < 1e-9;
  }

  private importNumberRequired(
    value: unknown,
    label: string,
    errors: string[],
  ): number | null {
    const parsed = parseImportNumber(value);
    if (parsed == null || !Number.isFinite(parsed)) {
      errors.push(`${label} debe ser un numero valido.`);
      return null;
    }
    return parsed;
  }

  private importNonNegativeNumber(
    value: unknown,
    label: string,
    errors: string[],
    defaultValue = 0,
  ): number | null {
    const hasText = normalizeImportText(value).length > 0;
    const parsed = hasText ? parseImportNumber(value) : defaultValue;
    if (parsed == null || !Number.isFinite(parsed)) {
      errors.push(`${label} debe ser un numero valido.`);
      return null;
    }
    if (parsed < 0) {
      errors.push(`${label} debe ser mayor o igual a cero.`);
      return null;
    }
    return parsed;
  }

  private sanitizeImportFileName(fileName?: string): string {
    const raw = normalizeImportText(fileName ?? '');
    return (raw || 'archivo sin nombre')
      .replace(/[^\w.\- ()[\]]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 160);
  }

  private inventoryImportNumberKey(value: unknown): string {
    const parsed = parseImportNumber(value);
    return parsed == null ? '' : String(parsed);
  }

  private inventoryImportPartNumberKey(value: unknown): string {
    return normalizeImportText(value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase();
  }

  private inventoryImportNaturalKey(parts: {
    name: unknown;
    family: unknown;
    subcategory: unknown;
    unit: unknown;
    brand: unknown;
    description: unknown;
    compatibility: unknown;
    supplier: unknown;
    warehouse: unknown;
    bin: unknown;
    location: unknown;
    stock: unknown;
    minStock: unknown;
    maxStock: unknown;
  }): string {
    return [
      parts.name,
      parts.family,
      parts.subcategory,
      parts.unit,
      parts.brand,
      parts.description,
      parts.compatibility,
      parts.supplier,
      parts.warehouse,
      parts.bin,
      parts.location,
      this.inventoryImportNumberKey(parts.stock),
      this.inventoryImportNumberKey(parts.minStock),
      this.inventoryImportNumberKey(parts.maxStock),
    ]
      .map(normalizeImportKey)
      .join('|');
  }

  async validateInventoryMasterImport(buffer: Buffer, user: any) {
    const tenantId = user.tenantId as string;
    const workbook = await parseBaseLogicMasterImportWorkbook(
      buffer,
      'inventory',
    );

    const warehouseScopeWhere = this.warehouseContractScopeWhere(user);
    const [items, allWarehouses, allowedWarehouses] =
      await this.prisma.$transaction([
        this.prisma.inventoryItem.findMany({
          where: { tenantId },
          include: {
            itemCategory: {
              select: {
                name: true,
                parentCategory: { select: { name: true } },
              },
            },
            unitOfMeasure: {
              select: { abbreviation: true, name: true, allowsDecimals: true },
            },
            inventorySupplier: { select: { name: true } },
            stocks: {
              select: {
                warehouseId: true,
                quantity: true,
                unitCost: true,
                minStock: true,
                maxStock: true,
                location: true,
                warehouse: { select: { code: true } },
                bin: { select: { code: true } },
              },
            },
          },
        }),
        this.prisma.warehouse.findMany({
          where: { tenantId },
          include: { bins: true },
        }),
        this.prisma.warehouse.findMany({
          where: warehouseScopeWhere,
          include: { bins: true },
        }),
      ]);

    const itemById = new Map(items.map((item) => [item.id, item]));
    const itemByInventoryCode = new Map(
      items
        .filter((item) => item.inventoryCode)
        .map((item) => [normalizeImportKey(item.inventoryCode), item]),
    );
    const itemByPartNumber = new Map(
      items
        .filter((item) => item.partNumber)
        .map((item) => [
          this.inventoryImportPartNumberKey(item.partNumber),
          item,
        ]),
    );
    const allWarehouseByCode = new Map(
      allWarehouses.map((warehouse) => [
        normalizeImportKey(warehouse.code),
        warehouse,
      ]),
    );
    const warehouseByCode = new Map(
      allowedWarehouses.map((warehouse) => [
        normalizeImportKey(warehouse.code),
        warehouse,
      ]),
    );

    const requirements = new Map<string, InventoryImportRequirement>();
    const previewRows: InventoryImportPreviewRow[] = [];
    const itemWarehouseKeys = new Map<string, number[]>();

    for (const row of workbook.rows) {
      const v = row.values;
      const id = getImportNullableString(v, 'ID articulo');
      const inventoryCode = getImportNullableString(v, 'Codigo inventario');
      const partNumber = getImportNullableString(v, 'Numero parte');
      const name = getImportString(v, 'Nombre');
      const family = getImportString(v, 'Familia');
      const subcategory = getImportString(v, 'Subcategoria');
      const unitCode = getImportString(v, 'Unidad');
      const warehouseCode = getImportNullableString(v, 'Bodega codigo');
      const binCode = getImportNullableString(v, 'Bin codigo');
      const errors: string[] = [];
      const warnings: string[] = [];

      const warehouse = warehouseCode
        ? warehouseByCode.get(normalizeImportKey(warehouseCode))
        : null;
      const warehouseInTenant = warehouseCode
        ? allWarehouseByCode.get(normalizeImportKey(warehouseCode))
        : null;
      if (warehouseCode && warehouseInTenant && !warehouse) {
        errors.push(
          `Bodega fuera del alcance de sus contratos permitidos: ${warehouseCode}.`,
        );
      } else if (warehouseCode && !warehouse) {
        this.registerInventoryRequirement(requirements, {
          kind: 'WAREHOUSE',
          code: warehouseCode,
          rows: [row.rowNumber],
          severity: 'blocking',
          message: 'Debe existir la bodega antes de importar stock.',
        });
        errors.push(`Bodega no existe: ${warehouseCode}.`);
      }
      if (binCode && warehouse) {
        const bin = warehouse.bins.find(
          (candidate) =>
            normalizeImportKey(candidate.code) === normalizeImportKey(binCode),
        );
        if (!bin) {
          this.registerInventoryRequirement(requirements, {
            kind: 'BIN',
            code: binCode,
            parentCode: warehouse.code,
            rows: [row.rowNumber],
            severity: 'warning',
            message:
              'La ubicacion/bin no existe; se creara automaticamente al confirmar la importacion.',
          });
          warnings.push(
            `Bin no existe en bodega ${warehouse.code}: ${binCode}. Se creara automaticamente.`,
          );
        }
      }

      const existingById = id ? itemById.get(id) : null;
      const existingByInventoryCode = inventoryCode
        ? itemByInventoryCode.get(normalizeImportKey(inventoryCode))
        : null;
      const existingByPartNumber = partNumber
        ? itemByPartNumber.get(this.inventoryImportPartNumberKey(partNumber))
        : null;
      const existing =
        existingById ??
        existingByInventoryCode ??
        existingByPartNumber ??
        null;

      if (!existing) {
        errors.push(
          'El Excel solo permite ajustar stock de articulos existentes. Cree el articulo en BaseLogic y vuelva a exportar.',
        );
      } else if (id && existing.id !== id) {
        errors.push(
          'ID articulo no coincide con el SKU/numero de parte informado. No se permite alterar la identidad del articulo desde Excel.',
        );
      }

      const duplicateKey = `${existing?.id || id || inventoryCode || partNumber || name}:${warehouseCode || 'NO_WAREHOUSE'}`;
      itemWarehouseKeys.set(duplicateKey, [
        ...(itemWarehouseKeys.get(duplicateKey) ?? []),
        row.rowNumber,
      ]);

      const existingStock = existing?.stocks.find(
        (stock) =>
          warehouseCode &&
          normalizeImportKey(stock.warehouse.code) ===
            normalizeImportKey(warehouseCode),
      );
      const changes: InventoryImportPreviewRow['changes'] = [];
      const compare = (field: string, before: unknown, after: unknown) => {
        const left = before ?? null;
        const right = after ?? null;
        if (JSON.stringify(left) !== JSON.stringify(right)) {
          changes.push({ field, before: left, after: right });
        }
      };
      const structuralCompare = (
        field: string,
        before: unknown,
        after: unknown,
      ) => {
        if (!existing) return;
        if (normalizeImportText(before) !== normalizeImportText(after)) {
          errors.push(
            `Cambio estructural no permitido en "${field}". Edite este dato desde Catalogo Maestro.`,
          );
        }
      };
      const structuralBooleanCompare = (
        field: string,
        before: boolean,
        after: unknown,
      ) => {
        const raw = normalizeImportText(after);
        const parsed = parseImportBoolean(after);
        if (raw && parsed == null) {
          errors.push(`Valor invalido para "${field}". Use SI o NO.`);
          return;
        }
        structuralCompare(field, boolLabel(before), raw ? boolLabel(parsed ?? before) : '');
      };

      if (existing) {
        const familyCurrent =
          existing.itemCategory.parentCategory?.name ?? existing.itemCategory.name;
        const subcategoryCurrent = existing.itemCategory.parentCategory
          ? existing.itemCategory.name
          : '';
        if (id) structuralCompare('ID articulo', existing.id, id);
        if (inventoryCode) {
          structuralCompare(
            'Codigo inventario',
            existing.inventoryCode,
            inventoryCode,
          );
        }
        if (partNumber || existing.partNumber) {
          structuralCompare('Numero parte', existing.partNumber, partNumber);
        }
        structuralCompare('Nombre', existing.name, name);
        structuralCompare(
          'Descripcion',
          existing.description,
          getImportNullableString(v, 'Descripcion'),
        );
        structuralCompare('Familia', familyCurrent, family);
        structuralCompare('Subcategoria', subcategoryCurrent, subcategory);
        structuralCompare('Unidad', existing.unitOfMeasure.abbreviation, unitCode);
        structuralCompare(
          'Unidad nombre',
          existing.unitOfMeasure.name,
          getImportNullableString(v, 'Unidad nombre'),
        );
        structuralCompare(
          'Permite decimales',
          boolLabel(existing.unitOfMeasure.allowsDecimals),
          getImportNullableString(v, 'Permite decimales'),
        );
        structuralCompare('Marca', existing.brand, getImportNullableString(v, 'Marca'));
        structuralCompare(
          'Compatibilidad',
          existing.compatibilityInfo,
          getImportNullableString(v, 'Compatibilidad'),
        );
        structuralCompare(
          'Proveedor habitual',
          existing.inventorySupplier?.name ?? null,
          getImportNullableString(v, 'Proveedor habitual'),
        );
        structuralBooleanCompare('Inventariable', existing.isInventory, v['Inventariable']);
        structuralBooleanCompare('Consumible', existing.isConsumable, v['Consumible']);
        structuralBooleanCompare('Activo', existing.isAsset, v['Activo']);
        structuralBooleanCompare('Serializado', existing.isSerialized, v['Serializado']);
        structuralCompare(
          'QR payload',
          existing.qrCode,
          getImportNullableString(v, 'QR payload'),
        );
        structuralCompare(
          'Politica minimo',
          existing.policyMinStock,
          parseImportNumber(v['Politica minimo']),
        );
        structuralCompare(
          'Politica maximo',
          existing.policyMaxStock,
          parseImportNumber(v['Politica maximo']),
        );

        if (normalizeImportText(v['CPP'])) {
          warnings.push('CPP es informativo y sera ignorado al importar.');
        }

        const quantity = warehouse
          ? this.importNumberRequired(v['Stock'], 'Stock', errors)
          : parseImportNumber(v['Stock']);
        const minStock = warehouse
          ? this.importNonNegativeNumber(v['Stock minimo'], 'Stock minimo', errors)
          : parseImportNumber(v['Stock minimo']);
        const maxStock = warehouse
          ? this.importNonNegativeNumber(v['Stock maximo'], 'Stock maximo', errors)
          : parseImportNumber(v['Stock maximo']);
        if (warehouse && quantity != null && quantity < 0) {
          errors.push('Stock debe ser mayor o igual a cero.');
        }
        if (
          warehouse &&
          maxStock != null &&
          minStock != null &&
          maxStock > 0 &&
          maxStock < minStock
        ) {
          errors.push('Stock maximo no puede ser menor que Stock minimo.');
        }
        if (
          warehouse &&
          !existing.unitOfMeasure.allowsDecimals &&
          [quantity, minStock, maxStock].some(
            (n) => n != null && !this.isIntegerQuantityAllowed(n),
          )
        ) {
          errors.push(
            `La unidad ${existing.unitOfMeasure.abbreviation} no admite decimales; stock y umbrales deben ser enteros.`,
          );
        }
        const rowHasStockWithoutWarehouse =
          !warehouseCode &&
          [
            parseImportNumber(v['Stock']) ?? 0,
            parseImportNumber(v['Stock minimo']) ?? 0,
            parseImportNumber(v['Stock maximo']) ?? 0,
          ].some((n) => Math.abs(n) > 1e-9);
        if (rowHasStockWithoutWarehouse) {
          errors.push('Debe informar Bodega codigo para ajustar stock.');
        }

        if (existingStock) {
          compare('stock.quantity', existingStock.quantity, quantity ?? 0);
          compare('stock.minStock', existingStock.minStock, minStock ?? 0);
          compare('stock.maxStock', existingStock.maxStock, maxStock ?? 0);
          compare(
            'stock.location',
            existingStock.location,
            getImportNullableString(v, 'Ubicacion stock'),
          );
          compare('stock.bin', existingStock.bin?.code ?? null, binCode);
        } else if (warehouseCode) {
          changes.push({ field: 'stock', before: null, after: warehouseCode });
        }
      }

      previewRows.push({
        rowNumber: row.rowNumber,
        action: errors.length
          ? 'ERROR'
          : existing
            ? changes.length
              ? 'UPDATE'
              : 'NO_CHANGE'
            : 'CREATE',
        itemId: existing?.id ?? null,
        inventoryCode,
        partNumber,
        warehouseCode,
        label: [inventoryCode, partNumber, name].filter(Boolean).join(' · '),
        errors,
        warnings,
        changes,
      });
    }

    for (const rows of itemWarehouseKeys.values()) {
      if (rows.length <= 1) continue;
      for (const preview of previewRows.filter((row) =>
        rows.includes(row.rowNumber),
      )) {
        preview.errors.push(
          `Fila duplicada para el mismo articulo/bodega: ${rows.join(', ')}.`,
        );
        preview.action = 'ERROR';
      }
    }

    const deleteCandidates: InventoryDeleteCandidate[] = [];

    return {
      domain: 'inventory' as const,
      version: workbook.version,
      summary: {
        rows: previewRows.length,
        creates: previewRows.filter((row) => row.action === 'CREATE').length,
        updates: previewRows.filter((row) => row.action === 'UPDATE').length,
        unchanged: previewRows.filter((row) => row.action === 'NO_CHANGE')
          .length,
        errors: previewRows.reduce(
          (count, row) => count + row.errors.length,
          0,
        ),
        deleteCandidates: 0,
      },
      requirements: [...requirements.values()],
      previewRows,
      deleteCandidates,
      configuration: {
        requiredBeforeCommit: [
          'Articulos existentes en Catalogo Maestro',
          'Bodegas existentes',
          'Bins existentes si se informan en el Excel',
          'Acceso por contrato a cada bodega ajustada',
          'Cantidades validas segun unidad de medida',
        ],
        options: {
          allowCreates: false,
          allowUpdates: false,
          allowStockAdjustments: true,
          allowItemDeletes: false,
          autoCreateBins: true,
          autoCreateSuppliers: false,
        },
      },
    };
  }

  async commitInventoryMasterImport(
    buffer: Buffer,
    user: any,
    options: InventoryImportOptions = {},
    fileName?: string,
  ) {
    const tenantId = user.tenantId as string;
    const userId = user.id || user.sub;
    if (!userId) {
      throw new BadRequestException(
        'Usuario no identificado para auditoria de stock.',
      );
    }

    const validation = await this.validateInventoryMasterImport(buffer, user);
    const blockingRows = validation.previewRows.filter(
      (row) => row.errors.length > 0,
    );
    const blockingRequirements = validation.requirements.filter(
      (req) => req.severity === 'blocking',
    );
    if (blockingRows.length || blockingRequirements.length) {
      throw new BadRequestException({
        message:
          'La importacion tiene errores bloqueantes. Valide requisitos antes de confirmar.',
        blockingRows: blockingRows.length,
        blockingRequirements,
      });
    }

    const allowCreates = false;
    const allowUpdates = false;
    const allowStockAdjustments = options.allowStockAdjustments !== false;
    const allowItemDeletes = false;
    const autoCreateBins = options.autoCreateBins !== false;
    const autoCreateSuppliers = false;
    const disabledAutoCreateRequirements = validation.requirements.filter(
      (req) =>
        (req.kind === 'BIN' && !autoCreateBins) ||
        (req.kind === 'SUPPLIER' && !autoCreateSuppliers),
    );
    if (disabledAutoCreateRequirements.length > 0) {
      throw new BadRequestException({
        message:
          'La importacion requiere crear bins o proveedores faltantes. Active la autocreacion o cree los maestros antes de confirmar.',
        requirements: disabledAutoCreateRequirements,
      });
    }

    if (
      !allowCreates &&
      validation.previewRows.some((row) => row.action === 'CREATE')
    ) {
      throw new BadRequestException(
        'La importacion contiene altas, pero allowCreates=false.',
      );
    }
    if (
      !allowUpdates &&
      validation.previewRows.some((row) => row.action === 'CREATE')
    ) {
      throw new BadRequestException(
        'La importacion contiene cambios estructurales de articulos, pero el Excel solo permite ajustes de stock.',
      );
    }
    if (
      !allowStockAdjustments &&
      validation.previewRows.some((row) => row.action === 'UPDATE')
    ) {
      throw new BadRequestException(
        'La importacion contiene ajustes de stock, pero allowStockAdjustments=false.',
      );
    }

    const workbook = await parseBaseLogicMasterImportWorkbook(
      buffer,
      'inventory',
    );
    const warehouseScopeWhere = this.warehouseContractScopeWhere(user);
    const [warehouses, existingItems] =
      await this.prisma.$transaction([
        this.prisma.warehouse.findMany({
          where: warehouseScopeWhere,
          include: { bins: true },
        }),
        this.prisma.inventoryItem.findMany({ where: { tenantId } }),
      ]);

    const warehouseByCode = new Map(
      warehouses.map((warehouse) => [
        normalizeImportKey(warehouse.code),
        warehouse,
      ]),
    );
    const itemById = new Map(existingItems.map((item) => [item.id, item]));
    const itemByInventoryCode = new Map(
      existingItems
        .filter((item) => item.inventoryCode)
        .map((item) => [normalizeImportKey(item.inventoryCode), item]),
    );
    const itemByPartNumber = new Map(
      existingItems
        .filter((item) => item.partNumber)
        .map((item) => [
          this.inventoryImportPartNumberKey(item.partNumber),
          item,
        ]),
    );
    const previewByRowNumber = new Map(
      validation.previewRows.map((preview) => [preview.rowNumber, preview]),
    );

    let created = 0;
    let updated = 0;
    let unchanged = 0;
    let stockAdjusted = 0;
    let deleted = 0;
    const importFileName = this.sanitizeImportFileName(fileName);

    await this.prisma.$transaction(async (tx) => {
      for (const row of workbook.rows) {
        const preview = previewByRowNumber.get(row.rowNumber);
        if (!preview || preview.action === 'ERROR') continue;
        if (preview.action === 'NO_CHANGE') {
          unchanged++;
          continue;
        }

        const v = row.values;
        const id = getImportNullableString(v, 'ID articulo');
        const inventoryCode = getImportNullableString(v, 'Codigo inventario');
        const partNumber = getImportNullableString(v, 'Numero parte');
        const warehouseCode = getImportNullableString(v, 'Bodega codigo');
        const warehouse = warehouseCode
          ? warehouseByCode.get(normalizeImportKey(warehouseCode))
          : null;
        const existing =
          (id ? itemById.get(id) : null) ??
          (inventoryCode
            ? itemByInventoryCode.get(normalizeImportKey(inventoryCode))
            : null) ??
          (partNumber
            ? itemByPartNumber.get(
                this.inventoryImportPartNumberKey(partNumber),
              )
            : null) ??
          null;

        if (!existing || !warehouse) {
          unchanged++;
          continue;
        }

        this.assertCanAccessWarehouseContract(user, warehouse.contractId);
        if (!allowStockAdjustments) continue;

        const itemId = existing.id;

        const binCode = getImportNullableString(v, 'Bin codigo');
        let bin = binCode
          ? warehouse.bins.find(
              (candidate) =>
                normalizeImportKey(candidate.code) ===
                normalizeImportKey(binCode),
            )
          : null;
        if (binCode && !bin && autoCreateBins) {
          const normalizedBinCode = this.normalizeWarehouseBinCode(binCode);
          if (normalizedBinCode) {
            bin = await tx.warehouseBin.upsert({
              where: {
                warehouseId_code: {
                  warehouseId: warehouse.id,
                  code: normalizedBinCode,
                },
              },
              update: {
                label: binCode.slice(0, 100),
              },
              create: {
                warehouseId: warehouse.id,
                code: normalizedBinCode,
                label: binCode.slice(0, 100),
              },
            });
            warehouse.bins.push(bin);
          }
        }
        const quantity = parseImportNumber(v['Stock']) ?? 0;
        const minStock = parseImportNumber(v['Stock minimo']) ?? 0;
        const maxStock = parseImportNumber(v['Stock maximo']) ?? 0;
        const currentStock = await tx.itemStock.findUnique({
          where: {
            warehouseId_itemId: {
              warehouseId: warehouse.id,
              itemId,
            },
          },
        });
        const previousStock = currentStock?.quantity ?? 0;
        const nextStock = quantity;
        const nextUnitCost = currentStock?.unitCost ?? null;

        await tx.itemStock.upsert({
          where: {
            warehouseId_itemId: {
              warehouseId: warehouse.id,
              itemId,
            },
          },
          update: {
            quantity: nextStock,
            unitCost: nextUnitCost,
            minStock,
            maxStock,
            location: getImportNullableString(v, 'Ubicacion stock'),
            binId: bin?.id ?? null,
          },
          create: {
            warehouseId: warehouse.id,
            itemId,
            quantity: nextStock,
            unitCost: nextUnitCost,
            minStock,
            maxStock,
            location: getImportNullableString(v, 'Ubicacion stock'),
            binId: bin?.id ?? null,
          },
        });

        if (Math.abs(previousStock - nextStock) > 1e-9) {
          await tx.inventoryTransaction.create({
            data: {
              warehouseId: warehouse.id,
              itemId,
              userId,
              type: TransactionType.ADJUST,
              quantity: nextStock - previousStock,
              previousStock,
              newStock: nextStock,
              notes: `Ajuste desde importacion Excel inventario · fila ${row.rowNumber} · archivo ${importFileName}`,
            },
          });
          stockAdjusted++;
        }
        updated++;
      }
    });

    return {
      created,
      updated,
      unchanged,
      stockAdjusted,
      deleted,
      skippedDeleteCandidates: allowItemDeletes
        ? 0
        : validation.deleteCandidates.length,
      warnings:
        validation.deleteCandidates.length > 0 && !allowItemDeletes
          ? [
              'Se detectaron articulos ausentes en el Excel. No fueron eliminados porque allowItemDeletes=false.',
            ]
          : [],
    };
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
        const stockAvailableQuantity =
          warehouseIdForStock && stockQuantity != null
            ? Number(stockQuantity ?? 0) - (reservedByItemId.get(row.id) ?? 0)
            : null;
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
          stockAvailableQuantity,
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

  async findOne(idOrCode: string, user: any) {
    const id = await this.resolveInventoryItemRecordId(idOrCode, user.tenantId);
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
    idOrCode: string,
    user: any,
    options: { qr: InventoryLabelQrMode; size: InventoryLabelSize },
  ): Promise<{ stream: Readable; filename: string }> {
    const id = await this.resolveInventoryItemRecordId(idOrCode, user.tenantId);
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
    const subfamilyName: string = cat?.parentCategoryId
      ? (cat?.name ?? '')
      : '';
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
        select: { id: true, inventoryCode: true, name: true },
      });
      if (existingPn) {
        throw new BadRequestException(
          this.duplicatePartNumberMessage(existingPn),
        );
      }
    }

    if (dto.inventoryCode?.trim()) {
      throw new BadRequestException(
        'El código de inventario lo asigna el sistema; no envíe "inventoryCode" al crear el artículo.',
      );
    }

    const createdItem = await this.prisma
      .$transaction(async (tx) => {
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
      })
      .catch(async (e: unknown) => {
        await this.rethrowIfPartNumberUniqueViolation(e, user.tenantId, pn);
        throw e;
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

  async update(idOrCode: string, dto: UpdateInventoryItemDto, user: any) {
    const id = await this.resolveInventoryItemRecordId(idOrCode, user.tenantId);
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
        where: {
          tenantId: user.tenantId,
          partNumber: mergedPn,
          id: { not: id },
        },
        select: { id: true, inventoryCode: true, name: true },
      });
      if (existingPn) {
        throw new BadRequestException(
          this.duplicatePartNumberMessage(existingPn),
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
        select: { inventoryCode: true, name: true },
      });
      if (existingPn) {
        throw new BadRequestException(
          this.duplicatePartNumberMessage(existingPn),
        );
      }
    }
    const isSerialized = dto.isSerialized ?? false;
    const isInventory = dto.isInventory ?? true;
    const isAsset = dto.isAsset ?? false;
    const isConsumable = dto.isConsumable ?? true;

    const partNumberForConflict = requestedPn ? requestedPn : null;

    const createdItem = await this.prisma
      .$transaction(
        async (tx) => {
          await this.assertLeafCategoryWithTx(
            tx,
            dto.categoryId,
            user.tenantId,
          );
          await this.assertUnitOfMeasureTx(
            tx,
            dto.unitOfMeasureId,
            user.tenantId,
          );

          await this.ensureInventorySkuCounterFloor(user.tenantId, tx);

          const partNumber = partNumberForConflict;
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
      )
      .catch(async (e: unknown) => {
        await this.rethrowIfPartNumberUniqueViolation(
          e,
          user.tenantId,
          partNumberForConflict,
        );
        throw e;
      });

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
    itemIdOrCode: string,
    user: any,
    opts: { page?: number; pageSize?: number; warehouseId?: string },
  ) {
    const tenantId = user.tenantId as string;
    const itemId = await this.resolveInventoryItemRecordId(
      itemIdOrCode,
      tenantId,
    );
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

  async remove(idOrCode: string, user: any) {
    const { id } = await this.findOne(idOrCode, user);

    try {
      return await this.prisma.inventoryItem.delete({
        where: { id },
      });
    } catch (_error) {
      throw new BadRequestException(
        'No se puede eliminar el artículo porque ya tiene historial de stock o transacciones en bodegas.',
      );
    }
  }

  async listAttachments(itemIdOrCode: string, user: any) {
    const tenantId = user.tenantId as string;
    const itemId = await this.resolveInventoryItemRecordId(
      itemIdOrCode,
      tenantId,
    );
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
    itemIdOrCode: string,
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

    const itemId = await this.resolveInventoryItemRecordId(
      itemIdOrCode,
      tenantId,
    );
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

  async removeAttachment(
    itemIdOrCode: string,
    attachmentId: string,
    user: any,
  ) {
    const tenantId = user.tenantId as string;
    const itemId = await this.resolveInventoryItemRecordId(
      itemIdOrCode,
      tenantId,
    );
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
