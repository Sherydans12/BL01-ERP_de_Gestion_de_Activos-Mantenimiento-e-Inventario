import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MeterLogSource, Prisma, ShiftType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { applyCurrentMeterChange } from '../equipments/equipment-meter-sync';
import { CreateEquipmentAvailabilityDto } from './dto/create-equipment-availability.dto';
import { UnreportedQueryDto } from './dto/unreported-query.dto';

export interface ListAvailabilityQuery {
  page?: string;
  pageSize?: string;
  equipmentId?: string;
  shift?: ShiftType;
  dateFrom?: string;
  dateTo?: string;
}

/**
 * Derivo `isAvailable` en runtime — no se persiste en DB.
 * STANDBY y RESERVE_NO_OPERATOR se consideran "disponibles" para KPIs de uptime.
 */
export function isAvailableStatus(
  status: Prisma.EquipmentAvailabilityGetPayload<object>['status'],
): boolean {
  return (
    status === 'OPERATIONAL' ||
    status === 'STANDBY' ||
    status === 'RESERVE_NO_OPERATOR'
  );
}

@Injectable()
export class EquipmentAvailabilityService {
  constructor(private readonly prisma: PrismaService) {}

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
    reportedBy: { select: { id: true, name: true } },
  } as const;

  /**
   * Registra el estado operativo de un equipo para un turno específico.
   *
   * - Un equipo solo puede tener un reporte por (tenantId, equipmentId, reportDate, shift).
   *   La violación del @@unique lanza P2002 → se convierte en ConflictException.
   * - Si `meterReading` es mayor al `currentMeter` del equipo, actualiza el horómetro
   *   vía `applyCurrentMeterChange` con `source = AVAILABILITY_REPORT`.
   * - Si `meterReading` es menor o igual, el reporte se guarda SIN error (lectura tardía
   *   o corrección del supervisor; el medidor físico no retrocede).
   *
   * Todo ocurre dentro de una transacción Serializable.
   */
  async create(dto: CreateEquipmentAvailabilityDto, user: any) {
    const tenantId = user.tenantId as string;
    const userId = (user.id ?? user.sub) as string;

    return this.prisma.$transaction(
      async (tx) => {
        // ── 1. Validar que el equipo pertenece al tenant ──────────────────────
        const equipment = await tx.equipment.findFirst({
          where: { id: dto.equipmentId, tenantId },
          select: { id: true, currentMeter: true, contractId: true },
        });
        if (!equipment) {
          throw new NotFoundException(
            'El equipo no existe o no pertenece a este tenant.',
          );
        }

        // ── 2. Crear el registro de disponibilidad ────────────────────────────
        // La restricción @@unique del modelo atrapa duplicados a nivel de DB.
        let record: Prisma.EquipmentAvailabilityGetPayload<object>;
        try {
          record = await tx.equipmentAvailability.create({
            data: {
              tenantId,
              contractId: equipment.contractId ?? null,
              equipmentId: dto.equipmentId,
              reportedById: userId,
              reportDate: new Date(dto.reportDate),
              shift: dto.shift,
              status: dto.status,
              meterReading: dto.meterReading ?? null,
              comments: dto.comments ?? null,
            },
          });
        } catch (e) {
          if (
            e instanceof Prisma.PrismaClientKnownRequestError &&
            e.code === 'P2002'
          ) {
            throw new ConflictException(
              'El equipo ya tiene un reporte para este turno y fecha.',
            );
          }
          throw e;
        }

        // ── 3. Actualizar horómetro solo si avanza (silent ignore si retrocede) ─
        if (
          dto.meterReading != null &&
          dto.meterReading > equipment.currentMeter
        ) {
          await applyCurrentMeterChange(tx, {
            tenantId,
            equipmentId: dto.equipmentId,
            oldMeter: equipment.currentMeter,
            newMeter: dto.meterReading,
            source: MeterLogSource.AVAILABILITY_REPORT,
            sourceId: record.id,
            userId,
          });
        }

        return { ...record, isAvailable: isAvailableStatus(record.status) };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10_000,
        timeout: 30_000,
      },
    );
  }

  /**
   * Retorna los equipos activos (`isOperational = true`) que NO tienen reporte
   * para el turno y fecha indicados.
   *
   * Estrategia: 2 queries en paralelo (fleet + reported) + diff en memoria con Set.
   * Apropiada para flotas < ~500 equipos por contrato; para flotas mayores
   * se puede migrar a $queryRaw con NOT IN sin cambiar la firma del endpoint.
   */
  async findUnreported(user: any, query: UnreportedQueryDto) {
    const tenantId = user.tenantId as string;
    const isAdmin =
      user.role === 'ADMIN' || user.role === 'SUPER_ADMIN';
    const allowedContracts = user.allowedContracts as string[] | undefined;

    // Fecha normalizada a medianoche UTC para comparar con la columna @db.Date
    const reportDate = new Date(query.date);
    reportDate.setUTCHours(0, 0, 0, 0);

    const equipmentWhere: Prisma.EquipmentWhereInput = {
      tenantId,
      isOperational: true,
    };

    // Aplicar scope de contratos: ADMIN ve toda la flota; USER solo sus contratos
    if (!isAdmin && allowedContracts?.length) {
      equipmentWhere.contractId = { in: allowedContracts };
    }
    // Filtro explícito de contrato en query (ADMIN puede acotar la vista)
    if (query.contractId) {
      equipmentWhere.contractId = query.contractId;
    }

    const [fleet, reported] = await Promise.all([
      this.prisma.equipment.findMany({
        where: equipmentWhere,
        select: {
          id: true,
          internalId: true,
          brand: true,
          model: true,
          plate: true,
          contractId: true,
        },
      }),
      this.prisma.equipmentAvailability.findMany({
        where: { tenantId, reportDate, shift: query.shift },
        select: { equipmentId: true },
      }),
    ]);

    const reportedIds = new Set(reported.map((r) => r.equipmentId));
    return fleet.filter((e) => !reportedIds.has(e.id));
  }

  /**
   * Historial paginado de reportes de disponibilidad por tenant.
   * Filtros opcionales: equipmentId, shift, dateFrom, dateTo.
   */
  async findAll(user: any, query: ListAvailabilityQuery = {}) {
    const tenantId = user.tenantId as string;

    const page = Math.max(1, parseInt(String(query.page ?? '1'), 10) || 1);
    const pageSizeRaw = parseInt(String(query.pageSize ?? '25'), 10) || 25;
    const pageSize = Math.min(100, Math.max(1, pageSizeRaw));
    const skip = (page - 1) * pageSize;

    const where: Prisma.EquipmentAvailabilityWhereInput = { tenantId };

    if (query.equipmentId?.trim()) {
      where.equipmentId = query.equipmentId.trim();
    }
    if (query.shift) {
      where.shift = query.shift;
    }
    if (query.dateFrom || query.dateTo) {
      where.reportDate = {};
      if (query.dateFrom) {
        where.reportDate.gte = new Date(query.dateFrom);
      }
      if (query.dateTo) {
        const to = new Date(query.dateTo);
        to.setUTCHours(23, 59, 59, 999);
        where.reportDate.lte = to;
      }
    }

    const [rows, total] = await Promise.all([
      this.prisma.equipmentAvailability.findMany({
        where,
        include: this.listInclude,
        orderBy: [{ reportDate: 'desc' }, { shift: 'asc' }],
        skip,
        take: pageSize,
      }),
      this.prisma.equipmentAvailability.count({ where }),
    ]);

    const data = rows.map((row) => ({
      ...row,
      isAvailable: isAvailableStatus(row.status),
    }));

    return { data, total, page, pageSize };
  }

  /**
   * Retorna el detalle de un reporte específico validando el tenantId del JWT.
   */
  async findOne(id: string, user: any) {
    const tenantId = user.tenantId as string;

    const record = await this.prisma.equipmentAvailability.findFirst({
      where: { id, tenantId },
      include: this.listInclude,
    });

    if (!record) {
      throw new NotFoundException(
        'El reporte de disponibilidad no existe o no pertenece a este tenant.',
      );
    }

    return { ...record, isAvailable: isAvailableStatus(record.status) };
  }
}
