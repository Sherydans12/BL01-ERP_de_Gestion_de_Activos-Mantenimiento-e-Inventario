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
import { CreateLubeReportDto } from './dto/create-lube-report.dto';

export interface ListLubeReportsQuery {
  page?: string;
  pageSize?: string;
  warehouseId?: string;
  equipmentId?: string;
  dateFrom?: string;
  dateTo?: string;
}

/** Tipo de referencia inyectado en InventoryTransaction para despachos de lubricante. */
const LUBE_DISPATCH_REFERENCE_TYPE = 'LUBE_DISPATCH';

/** Prefijo del correlativo para reportes de consumo de lubricantes. */
const LUBE_REPORT_PREFIX = 'RCL';
const LUBE_REPORT_DOCUMENT_TYPE = 'LUBE_REPORT';

@Injectable()
export class LubeReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequenceService: SequenceService,
  ) {}

  /**
   * Registra un despacho de lubricantes:
   * - Valida que la bodega origen pertenece al tenant y al contrato.
   * - Valida y actualiza el horómetro del equipo si se provee.
   * - Descuenta el stock físico por cada línea usando el CPP actual (congelado).
   * - Genera las filas inmutables en `InventoryTransaction` (type OUT, referenceType LUBE_DISPATCH).
   * - Crea el encabezado `LubeReport` y sus `LubeReportLine`.
   * - Registra el costo directo en `AssetCostRecord`.
   *
   * Todo ocurre dentro de una transacción Serializable para garantizar atomicidad
   * y evitar condiciones de carrera sobre el stock.
   */
  async createReport(dto: CreateLubeReportDto, user: any) {
    const tenantId = user.tenantId as string;
    const userId = (user.id ?? user.sub) as string;

    return this.prisma.$transaction(
      async (tx) => {
        // ── 1. Validar bodega: debe pertenecer al tenant Y al contrato del DTO ──
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

        // ── 2. Validar que el equipo pertenece al tenant ──
        const equipment = await tx.equipment.findFirst({
          where: { id: dto.equipmentId, tenantId },
        });
        if (!equipment) {
          throw new NotFoundException(
            'El equipo no existe o no pertenece a este tenant.',
          );
        }

        // ── 3. Validar y aplicar horómetro si se provee ──
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

        // ── 4. Generar correlativo atómico ──
        const correlative = await this.sequenceService.getNextCorrelative(
          tenantId,
          LUBE_REPORT_DOCUMENT_TYPE,
          LUBE_REPORT_PREFIX,
          { tx, padWidth: 5 },
        );

        // ── 5. Crear encabezado del reporte ──
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

        // ── 6. Procesar cada línea del despacho ──
        let totalDispatchCost = new Decimal(0);

        for (const line of dto.lines) {
          // 6a. Leer stock actual para obtener CPP y cantidad
          const currentStock = await tx.itemStock.findUnique({
            where: {
              warehouseId_itemId: {
                warehouseId: dto.warehouseId,
                itemId: line.itemId,
              },
            },
          });

          const previousQty = currentStock?.quantity ?? 0;
          const frozenUnitCost = Number(currentStock?.unitCost ?? 0);
          const newQty = previousQty - line.quantity;
          const isPendingRegularization = newQty < 0;

          // 6b. Actualizar stock físico (upsert por si no existe la fila)
          await tx.itemStock.upsert({
            where: {
              warehouseId_itemId: {
                warehouseId: dto.warehouseId,
                itemId: line.itemId,
              },
            },
            update: { quantity: newQty },
            create: {
              warehouseId: dto.warehouseId,
              itemId: line.itemId,
              quantity: newQty,
              unitCost: 0,
              minStock: 0,
              maxStock: 0,
            },
          });

          // 6c. Crear movimiento inmutable en el kardex
          await tx.inventoryTransaction.create({
            data: {
              type: 'OUT',
              quantity: line.quantity,
              previousStock: previousQty,
              newStock: newQty,
              isPendingRegularization,
              referenceId: report.id,
              referenceType: LUBE_DISPATCH_REFERENCE_TYPE,
              notes: `Despacho lubricante ${correlative}`,
              warehouse: { connect: { id: dto.warehouseId } },
              item: { connect: { id: line.itemId } },
              user: { connect: { id: userId } },
            },
          });

          // 6d. Crear la línea del reporte con el CPP congelado
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

        // ── 7. Registrar costo directo en el activo ──
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

  // ── Includes reutilizables ──────────────────────────────────────────────

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

  // ── Listado paginado ────────────────────────────────────────────────────

  async findAll(user: any, query: ListLubeReportsQuery = {}) {
    const tenantId = user.tenantId as string;

    const page = Math.max(1, parseInt(String(query.page ?? '1'), 10) || 1);
    const pageSizeRaw = parseInt(String(query.pageSize ?? '25'), 10) || 25;
    const pageSize = Math.min(100, Math.max(1, pageSizeRaw));
    const skip = (page - 1) * pageSize;

    const where: Prisma.LubeReportWhereInput = { tenantId };

    if (query.warehouseId?.trim()) {
      where.warehouseId = query.warehouseId.trim();
    }
    if (query.equipmentId?.trim()) {
      where.equipmentId = query.equipmentId.trim();
    }
    if (query.dateFrom || query.dateTo) {
      where.dispatchDate = {};
      if (query.dateFrom) {
        where.dispatchDate.gte = new Date(query.dateFrom);
      }
      if (query.dateTo) {
        // Inclusive end: tomar hasta el fin del día indicado.
        const to = new Date(query.dateTo);
        to.setHours(23, 59, 59, 999);
        where.dispatchDate.lte = to;
      }
    }

    const [rows, total] = await Promise.all([
      this.prisma.lubeReport.findMany({
        where,
        include: this.listInclude,
        orderBy: { dispatchDate: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.lubeReport.count({ where }),
    ]);

    const data = rows.map(({ _count, ...rest }) => ({
      ...rest,
      lineCount: _count.lines,
    }));

    return { data, total, page, pageSize };
  }

  // ── Detalle con líneas ──────────────────────────────────────────────────

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
