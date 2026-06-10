import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import Decimal from 'decimal.js';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SequenceService } from '../../common/sequence/sequence.service';
import { applyCurrentMeterChange } from '../equipments/equipment-meter-sync';
import { InventoryStockService } from '../inventory-stock/inventory-stock.service';
import {
  assertLargeDispatchConfirmed,
  assertQuantityAllowedForUom,
} from '../../common/inventory/fluid-dispatch-limits.util';
import { CreateLubeReportDto } from './dto/create-lube-report.dto';

export interface ListLubeReportsQuery {
  page?: string;
  pageSize?: string;
  warehouseId?: string;
  equipmentId?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  sort?: string;
  dir?: string;
}

const LUBE_LIST_SORT_FIELDS = [
  'dispatchDate',
  'correlative',
  'createdAt',
  'meterReading',
  'warehouseName',
  'equipmentInternalId',
  'userName',
] as const;

type LubeReportListSortField = (typeof LUBE_LIST_SORT_FIELDS)[number];

const LUBE_LIST_SEARCH_MAX_LEN = 120;

function isLubeReportListSortField(v: string): v is LubeReportListSortField {
  return (LUBE_LIST_SORT_FIELDS as readonly string[]).includes(v);
}

function parseLubeReportListSort(
  sort?: string,
  dir?: string,
): { field: LubeReportListSortField; order: 'asc' | 'desc' } {
  const field: LubeReportListSortField =
    sort && isLubeReportListSortField(sort) ? sort : 'dispatchDate';
  if (dir === 'asc' || dir === 'desc') {
    return { field, order: dir };
  }
  if (
    field === 'dispatchDate' ||
    field === 'createdAt' ||
    field === 'meterReading'
  ) {
    return { field, order: 'desc' };
  }
  return { field, order: 'asc' };
}

function buildLubeReportListOrderBy(
  field: LubeReportListSortField,
  order: 'asc' | 'desc',
): Prisma.LubeReportOrderByWithRelationInput {
  switch (field) {
    case 'correlative':
      return { correlative: order };
    case 'createdAt':
      return { createdAt: order };
    case 'meterReading':
      return { meterReading: order };
    case 'warehouseName':
      return { warehouse: { name: order } };
    case 'equipmentInternalId':
      return { equipment: { internalId: order } };
    case 'userName':
      return { user: { name: order } };
    case 'dispatchDate':
    default:
      return { dispatchDate: order };
  }
}

function buildLubeReportSearchOr(term: string): Prisma.LubeReportWhereInput[] {
  const contains = { contains: term, mode: 'insensitive' as const };
  const or: Prisma.LubeReportWhereInput[] = [
    { correlative: contains },
    { notes: contains },
    { equipment: { internalId: contains } },
    { equipment: { brand: contains } },
    { equipment: { model: contains } },
    { equipment: { plate: contains } },
    { warehouse: { code: contains } },
    { warehouse: { name: contains } },
    { user: { name: contains } },
  ];
  const uuidRe =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (uuidRe.test(term)) {
    or.push({ id: term });
  }
  return or;
}

/** Tipo de referencia inyectado en InventoryTransaction para despachos de lubricante. */
const LUBE_DISPATCH_REFERENCE_TYPE = 'LUBE_DISPATCH';

/** Prefijo del correlativo para reportes de consumo de lubricantes. */
const LUBE_REPORT_PREFIX = 'RCL';
/** Máx. 10 chars (`sequence_counters.document_type` VARCHAR(10)). */
const LUBE_REPORT_DOCUMENT_TYPE = 'LUBE_RCL';

@Injectable()
export class LubeReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequenceService: SequenceService,
    private readonly inventoryStockService: InventoryStockService,
  ) {}

  /**
   * Registra un despacho de lubricantes:
   * - Valida que la bodega origen pertenece al tenant y al contrato.
   * - Valida y actualiza el horómetro del equipo si se provee.
   * - Descuenta stock vía {@link InventoryStockService.performTransactionCore}.
   * - Crea el encabezado `LubeReport` y sus `LubeReportLine`.
   * - Registra el costo directo en `AssetCostRecord`.
   */
  async createReport(dto: CreateLubeReportDto, user: any) {
    const tenantId = user.tenantId as string;
    const userId = (user.id ?? user.sub) as string;

    return this.prisma.$transaction(
      async (tx) => {
        const warehouse = await tx.warehouse.findFirst({
          where: { id: dto.warehouseId, tenantId },
        });
        if (!warehouse) {
          throw new NotFoundException(
            'La bodega de origen no existe o no pertenece a este tenant.',
          );
        }
        if (warehouse.contractId !== dto.contractId) {
          throw new BadRequestException(
            'La bodega de origen no pertenece al contrato indicado.',
          );
        }

        const equipment = await tx.equipment.findFirst({
          where: { id: dto.equipmentId, tenantId },
        });
        if (!equipment) {
          throw new NotFoundException(
            'El equipo no existe o no pertenece a este tenant.',
          );
        }

        if (dto.meterReading !== undefined && dto.meterReading !== null) {
          if (dto.meterReading < equipment.currentMeter) {
            throw new BadRequestException(
              `El horómetro ingresado (${dto.meterReading}) es menor al valor actual del equipo (${equipment.currentMeter}). No se puede retroceder el medidor.`,
            );
          }
          if (dto.meterReading > equipment.currentMeter) {
            await applyCurrentMeterChange(tx, {
              tenantId,
              equipmentId: equipment.id,
              oldMeter: equipment.currentMeter,
              newMeter: dto.meterReading,
              source: 'MANUAL',
              sourceId: null,
              userId,
            });
          }
        }

        const correlative = await this.sequenceService.getNextCorrelative(
          tenantId,
          LUBE_REPORT_DOCUMENT_TYPE,
          LUBE_REPORT_PREFIX,
          { tx, padWidth: 5 },
        );

        const report = await tx.lubeReport.create({
          data: {
            tenantId,
            contractId: dto.contractId,
            equipmentId: dto.equipmentId,
            warehouseId: dto.warehouseId,
            userId,
            correlative,
            dispatchDate: new Date(dto.dispatchDate),
            meterReading: dto.meterReading ?? null,
            notes: dto.notes ?? null,
          },
        });

        let totalDispatchCost = new Decimal(0);

        for (const line of dto.lines) {
          const item = await tx.inventoryItem.findFirst({
            where: { id: line.itemId, tenantId },
            select: {
              id: true,
              partNumber: true,
              inventoryCode: true,
              unitOfMeasure: {
                select: { abbreviation: true, allowsDecimals: true },
              },
            },
          });
          if (!item) {
            throw new BadRequestException(
              'Un ítem del despacho no existe o no pertenece a su empresa.',
            );
          }

          const itemLabel =
            item.partNumber?.trim() || item.inventoryCode?.trim() || item.id;
          const unitAbbr = item.unitOfMeasure?.abbreviation ?? 'UN';
          const allowsDecimals = item.unitOfMeasure?.allowsDecimals ?? false;

          assertQuantityAllowedForUom(
            line.quantity,
            allowsDecimals,
            itemLabel,
            unitAbbr,
          );
          assertLargeDispatchConfirmed(
            line.quantity,
            unitAbbr,
            allowsDecimals,
            line.confirmedLargeDispatch,
            itemLabel,
          );

          const { stock } =
            await this.inventoryStockService.performTransactionCore(
              tx,
              {
                warehouseId: dto.warehouseId,
                itemId: line.itemId,
                type: 'OUT',
                quantity: line.quantity,
                referenceId: report.id,
                referenceType: LUBE_DISPATCH_REFERENCE_TYPE,
                notes: `Despacho lubricante ${correlative}`,
              },
              user,
            );

          const frozenUnitCost = Number(stock?.unitCost ?? 0);

          await tx.lubeReportLine.create({
            data: {
              reportId: report.id,
              itemId: line.itemId,
              quantity: line.quantity,
              unitCost: new Prisma.Decimal(frozenUnitCost),
            },
          });

          totalDispatchCost = totalDispatchCost.plus(
            new Decimal(frozenUnitCost).mul(line.quantity),
          );
        }

        if (totalDispatchCost.greaterThan(0)) {
          await tx.assetCostRecord.create({
            data: {
              tenantId,
              equipmentId: dto.equipmentId,
              amount: new Prisma.Decimal(totalDispatchCost.toFixed(4)),
              type: 'LUBE_DISPATCH',
            },
          });
        }

        return report;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10_000,
        timeout: 30_000,
      },
    );
  }

  private readonly listInclude = {
    equipment: {
      select: {
        id: true,
        internalId: true,
        brand: true,
        model: true,
        plate: true,
      },
    },
    warehouse: { select: { id: true, code: true, name: true } },
    user: { select: { id: true, name: true } },
    _count: { select: { lines: true } },
  } as const;

  private readonly detailInclude = {
    equipment: {
      select: {
        id: true,
        internalId: true,
        brand: true,
        model: true,
        plate: true,
      },
    },
    warehouse: { select: { id: true, code: true, name: true } },
    user: { select: { id: true, name: true } },
    lines: {
      include: {
        item: {
          select: {
            id: true,
            name: true,
            inventoryCode: true,
            partNumber: true,
            unitOfMeasure: {
              select: { id: true, name: true, abbreviation: true },
            },
          },
        },
      },
    },
  } as const;

  async findAll(user: any, query: ListLubeReportsQuery = {}) {
    const tenantId = user.tenantId as string;

    const pageSize = Math.min(
      100,
      Math.max(1, parseInt(String(query.pageSize ?? '25'), 10) || 25),
    );
    const requestedPage = Math.max(
      1,
      parseInt(String(query.page ?? '1'), 10) || 1,
    );
    const { field: sortField, order: sortOrder } = parseLubeReportListSort(
      query.sort,
      query.dir,
    );

    const and: Prisma.LubeReportWhereInput[] = [{ tenantId }];

    if (query.warehouseId?.trim()) {
      and.push({ warehouseId: query.warehouseId.trim() });
    }
    if (query.equipmentId?.trim()) {
      and.push({ equipmentId: query.equipmentId.trim() });
    }
    if (query.dateFrom || query.dateTo) {
      const dispatchDate: Prisma.DateTimeFilter = {};
      if (query.dateFrom) {
        dispatchDate.gte = new Date(query.dateFrom);
      }
      if (query.dateTo) {
        const to = new Date(query.dateTo);
        to.setHours(23, 59, 59, 999);
        dispatchDate.lte = to;
      }
      and.push({ dispatchDate });
    }

    const searchTerm =
      typeof query.search === 'string'
        ? query.search.trim().slice(0, LUBE_LIST_SEARCH_MAX_LEN)
        : '';
    if (searchTerm) {
      and.push({ OR: buildLubeReportSearchOr(searchTerm) });
    }

    const where: Prisma.LubeReportWhereInput =
      and.length === 1 ? and[0] : { AND: and };

    const total = await this.prisma.lubeReport.count({ where });
    const maxPage = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(requestedPage, maxPage);
    const skip = (page - 1) * pageSize;

    const rows = await this.prisma.lubeReport.findMany({
      where,
      include: this.listInclude,
      orderBy: buildLubeReportListOrderBy(sortField, sortOrder),
      skip,
      take: pageSize,
    });

    const data = rows.map(({ _count, ...rest }) => ({
      ...rest,
      lineCount: _count.lines,
    }));

    return { data, total, page, pageSize };
  }

  async findOne(id: string, user: any) {
    const tenantId = user.tenantId as string;

    const report = await this.prisma.lubeReport.findFirst({
      where: { id, tenantId },
      include: this.detailInclude,
    });

    if (!report) {
      throw new NotFoundException(
        'El reporte de lubricante no existe o no pertenece a este tenant.',
      );
    }

    return report;
  }
}
