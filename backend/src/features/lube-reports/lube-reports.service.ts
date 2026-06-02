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
}
