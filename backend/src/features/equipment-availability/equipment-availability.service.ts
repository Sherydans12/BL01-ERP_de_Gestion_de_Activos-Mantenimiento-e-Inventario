import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import ExcelJS from 'exceljs';
import {
  MeterLogSource,
  OperationalStatus,
  Prisma,
  ShiftType,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { applyCurrentMeterChange } from '../equipments/equipment-meter-sync';
import { sanitizeExcelWorksheetName } from '../../common/excel/excel-worksheet-name.util';
import { EquipmentOperationalOrchestratorService } from '../equipments/equipment-operational-orchestrator.service';
import {
  AvailabilitySideEffect,
  OperationalTransitionResult,
  toAvailabilitySideEffect,
} from '../equipments/operational-transition.types';
import { CreateEquipmentAvailabilityDto } from './dto/create-equipment-availability.dto';
import { UnreportedQueryDto } from './dto/unreported-query.dto';
import { ExportAvailabilityQueryDto } from './dto/export-availability-query.dto';
import { ImportAvailabilityCommitDto } from './dto/import-availability-commit.dto';
import { ShiftBoardQueryDto, ShiftBoardTab } from './dto/shift-board-query.dto';
import { BatchCreateAvailabilityDto } from './dto/batch-create-availability.dto';

// ─────────────────────────────────────────────────────────────────────────────
// Constants & types shared with controller / frontend interface
// ─────────────────────────────────────────────────────────────────────────────

export interface ListAvailabilityQuery {
  page?: string;
  pageSize?: string;
  equipmentId?: string;
  shift?: ShiftType;
  dateFrom?: string;
  dateTo?: string;
  contractId?: string;
  search?: string;
}

export type ShiftBoardRowKind = 'REPORTED' | 'PENDING' | 'EXCLUDED';

export interface ShiftBoardSummary {
  totalFleet: number;
  reportedCount: number;
  unreportedCount: number;
  excludedDownCount: number;
  completionPct: number;
  byStatus: Record<OperationalStatus, number>;
  byContract: Array<{
    contractId: string | null;
    totalFleet: number;
    reportedCount: number;
    unreportedCount: number;
  }>;
}

export interface ShiftBoardRow {
  equipmentId: string;
  internalId: string;
  brand: string;
  model: string;
  plate: string | null;
  contractId: string | null;
  isOperational: boolean;
  rowKind: ShiftBoardRowKind;
  availabilityId?: string;
  status?: OperationalStatus;
  meterReading?: number | null;
  comments?: string | null;
  isAvailable?: boolean;
  reportedBy?: { id: string; name: string } | null;
  reportedAt?: string | null;
}

export interface ShiftBoardResponse {
  date: string;
  shift: ShiftType;
  summary: ShiftBoardSummary;
  rows: ShiftBoardRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PaginatedUnreportedResponse {
  data: Array<{
    id: string;
    internalId: string;
    brand: string;
    model: string;
    plate: string | null;
    contractId: string | null;
    type?: string;
    currentMeter?: number;
    meterType?: string;
  }>;
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Map OperationalStatus → Spanish label used in the Excel dropdown.
 * Source of truth for both export and import parsing.
 */
export const EXCEL_STATUS_LABELS: Record<OperationalStatus, string> = {
  OPERATIONAL: 'Operativo',
  STANDBY: 'Standby',
  RESERVE_NO_OPERATOR: 'Reserva sin Operador',
  DOWN_FAILURE: 'Detenido por Falla',
  DOWN_MAINTENANCE: 'Detenido por Mantenimiento',
};

/** Reverse map: Spanish label → OperationalStatus enum. */
export const EXCEL_STATUS_MAP: Readonly<Record<string, OperationalStatus>> =
  Object.fromEntries(
    Object.entries(EXCEL_STATUS_LABELS).map(([enumKey, label]) => [
      label,
      enumKey,
    ]),
  ) as Record<string, OperationalStatus>;

export type ImportRowAction = 'CREATE' | 'UPDATE' | 'SKIP' | 'ERROR';

export interface ImportRowPreview {
  rowNum: number;
  equipmentId: string | null;
  equipmentLabel: string;
  status: OperationalStatus | null;
  statusLabel: string;
  meterReading: number | null;
  comments: string | null;
  action: ImportRowAction;
  currentStatus: OperationalStatus | null;
  /** Horómetro/odómetro vigente del equipo en la DB. */
  currentMeter: number | null;
  /** Unidad de medición del equipo: 'hrs' (HOURS) o 'km' (KILOMETERS). */
  meterUnit: 'hrs' | 'km';
  /** Advertencia no bloqueante (fila se importa igual, el usuario debe tomar nota). */
  warning: string | null;
  error: string | null;
}

export interface ImportValidationResult {
  reportDate: string;
  shift: ShiftType;
  rows: ImportRowPreview[];
  summary: {
    total: number;
    toCreate: number;
    toUpdate: number;
    withErrors: number;
    toSkip: number;
    withWarnings: number;
  };
}

export interface ImportCommitResult {
  committed: number;
  errors: Array<{ equipmentId: string; reason: string }>;
  /** Efectos colaterales (M2 detención → M3 stub / isOperational). */
  sideEffects?: AvailabilitySideEffect[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Safely coerce an ExcelJS CellValue to a plain string.
 * Avoids [object Object] when cells contain RichText, Hyperlink or Formula objects.
 */
function cellStr(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    const asAny = v as Record<string, unknown>;
    // RichText: join text fragments
    if ('richText' in asAny && Array.isArray(asAny['richText'])) {
      return (asAny['richText'] as Array<{ text?: unknown }>)
        .map((r) => {
          const t = r.text;
          if (t == null) return '';
          if (typeof t === 'string') return t;
          if (typeof t === 'number' || typeof t === 'boolean') return String(t);
          return '';
        })
        .join('');
    }
    // Formula with computed result
    if ('result' in asAny) {
      const res = asAny['result'];
      if (
        res != null &&
        (typeof res === 'string' ||
          typeof res === 'number' ||
          typeof res === 'boolean')
      ) {
        return String(res);
      }
    }
    // Hyperlink
    if ('text' in asAny && typeof asAny['text'] === 'string') {
      return asAny['text'];
    }
  }
  return '';
}

/**
 * Parsea el valor crudo de la celda de horómetro con tolerancia a formatos
 * comunes que el supervisor puede ingresar en Excel:
 *   - Número nativo de Excel → directo
 *   - "12450"  → 12450
 *   - "12.450" → 12450  (punto miles, estilo europeo)
 *   - "12,450" → 12450  (coma miles, estilo anglosajón)
 *   - "12450h" / "12450 hrs" → 12450  (texto con unidad)
 *   - "abc" / "" → null  (no numérico → error)
 *
 * Devuelve el entero redondeado o `null` si no es parseable.
 */
function parseMeterValue(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === 'number') {
    return isFinite(raw) && raw > 0 ? Math.round(raw) : null;
  }
  const str = cellStr(raw).trim();
  if (!str) return null;
  // Strip non-numeric suffix ("h", "hr", "hrs", "horas", spaces)
  const stripped = str.replace(/\s*(h|hr|hrs|horas)\.?\s*$/i, '').trim();
  // Remove thousands separators: if format is "12.450" or "12,450"
  // Heuristic: if last separator is at position -4 and no decimal follows → thousands
  let normalized = stripped;
  // Replace dots used as thousands separators (only when not decimal: "12.450" vs "12.45")
  // Pattern: digit.3digits at end → thousands
  if (/^\d{1,3}(\.\d{3})+$/.test(normalized)) {
    normalized = normalized.replace(/\./g, '');
  } else if (/^\d{1,3}(,\d{3})+$/.test(normalized)) {
    normalized = normalized.replace(/,/g, '');
  } else {
    // Remove any remaining commas/dots (mixed format safety net)
    normalized = normalized.replace(/[,.]/g, '');
  }
  const num = Number(normalized);
  if (!isFinite(num) || isNaN(num)) return null;
  return num > 0 ? Math.round(num) : null;
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

// ─────────────────────────────────────────────────────────────────────────────
// ExcelJS styling constants
// ─────────────────────────────────────────────────────────────────────────────

const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF334155' }, // slate-700
};
const HEADER_FONT: Partial<ExcelJS.Font> = {
  name: 'Calibri',
  bold: true,
  color: { argb: 'FFFFFFFF' },
  size: 11,
};
const LOCKED_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFF1F5F9' }, // slate-100 — signals non-editable
};
const EDITABLE_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFFFFFFF' },
};
const ROW_FONT: Partial<ExcelJS.Font> = { name: 'Calibri', size: 10 };

/** Comma-separated list of Spanish status labels for the dropdown formulae. */
const STATUS_DROPDOWN = Object.values(EXCEL_STATUS_LABELS).join(',');

/** System-level defaults for operational config — mirrors OPERATIONAL_CONFIG_DEFAULTS in tenant-config.service. */
const OPERATIONAL_DEFAULTS = {
  hasNightShift: true as boolean,
  dayShiftStartTime: '08:00',
  nightShiftStartTime: '20:00',
};

type OperationalConfigShape = typeof OPERATIONAL_DEFAULTS;

@Injectable()
export class EquipmentAvailabilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly operationalOrchestrator: EquipmentOperationalOrchestratorService,
  ) {}

  // ── Helpers: operational config & shift resolution ────────────────────────

  /**
   * Reads the tenant's operational config from DB.
   * Returns system defaults if no row has been persisted yet (lazy-creation pattern).
   */
  private async getOperationalConfig(
    tenantId: string,
  ): Promise<OperationalConfigShape> {
    const config = await this.prisma.tenantOperationalConfig.findUnique({
      where: { tenantId },
      select: {
        hasNightShift: true,
        dayShiftStartTime: true,
        nightShiftStartTime: true,
      },
    });
    return config ?? { ...OPERATIONAL_DEFAULTS };
  }

  /**
   * Turno efectivo para lecturas/escrituras operativas.
   * - Por defecto DAY si no se envía shift.
   * - Si el tenant no opera turno noche, NIGHT se normaliza a DAY (operación 24h en un solo turno).
   */
  private async resolveShift(
    tenantId: string,
    provided?: ShiftType | null,
  ): Promise<ShiftType> {
    const shift = provided ?? ShiftType.DAY;
    if (shift === ShiftType.NIGHT) {
      const config = await this.getOperationalConfig(tenantId);
      if (!config.hasNightShift) {
        return ShiftType.DAY;
      }
    }
    return shift;
  }

  private readonly listInclude = {
    equipment: {
      select: {
        id: true,
        internalId: true,
        brand: true,
        model: true,
        plate: true,
        isOperational: true,
        contractId: true,
      },
    },
    reportedBy: { select: { id: true, name: true } },
  } as const;

  /** Alcance de equipos por tenant + contratos del JWT. */
  private buildEquipmentScopeWhere(
    user: any,
    contractId?: string,
    options?: { operationalOnly?: boolean },
  ): Prisma.EquipmentWhereInput {
    const tenantId = user.tenantId as string;
    const isAdmin = user.role === 'ADMIN' || user.role === 'SUPER_ADMIN';
    const allowedContracts = user.allowedContracts as string[] | undefined;

    const where: Prisma.EquipmentWhereInput = { tenantId };
    if (options?.operationalOnly !== false) {
      where.isOperational = true;
    }

    if (!isAdmin && allowedContracts?.length) {
      where.contractId = { in: allowedContracts };
    }
    if (contractId) {
      where.contractId = contractId;
    }
    return where;
  }

  private mergeEquipmentSearch(
    base: Prisma.EquipmentWhereInput,
    search?: string,
  ): Prisma.EquipmentWhereInput {
    const q = search?.trim();
    if (!q) return base;
    return {
      AND: [
        base,
        {
          OR: [
            { internalId: { contains: q, mode: 'insensitive' } },
            { plate: { contains: q, mode: 'insensitive' } },
            { brand: { contains: q, mode: 'insensitive' } },
            { model: { contains: q, mode: 'insensitive' } },
            { mineInternalId: { contains: q, mode: 'insensitive' } },
          ],
        },
      ],
    };
  }

  private emptyStatusCounts(): Record<OperationalStatus, number> {
    return {
      OPERATIONAL: 0,
      STANDBY: 0,
      RESERVE_NO_OPERATOR: 0,
      DOWN_FAILURE: 0,
      DOWN_MAINTENANCE: 0,
    };
  }

  private filterShiftBoardTab(
    rows: ShiftBoardRow[],
    tab: ShiftBoardTab,
  ): ShiftBoardRow[] {
    switch (tab) {
      case 'REPORTED':
        return rows.filter((r) => r.rowKind === 'REPORTED');
      case 'PENDING':
        return rows.filter((r) => r.rowKind === 'PENDING');
      case 'EXCLUDED':
        return rows.filter((r) => r.rowKind === 'EXCLUDED');
      default:
        return rows;
    }
  }

  private normalizeReportDate(value: string | Date): Date {
    const reportDate = value instanceof Date ? new Date(value) : new Date(value);
    reportDate.setUTCHours(0, 0, 0, 0);
    return reportDate;
  }

  /**
   * Estado operativo anterior para side-effects de M2.
   *
   * La edición de la misma celda (fecha + turno) usa su status previo real.
   * Un parte nuevo toma el parte inmediatamente anterior del equipo: DAY para
   * NIGHT del mismo día, o el último parte de días previos.
   */
  private async resolvePreviousAvailabilityStatus(
    tx: Prisma.TransactionClient,
    input: {
      tenantId: string;
      equipmentId: string;
      reportDate: Date;
      shift: ShiftType;
      currentStatus?: OperationalStatus | null;
    },
  ): Promise<OperationalStatus | null> {
    if (input.currentStatus != null) {
      return input.currentStatus;
    }

    if (input.shift === ShiftType.NIGHT) {
      const sameDayDay = await tx.equipmentAvailability.findUnique({
        where: {
          tenantId_equipmentId_reportDate_shift: {
            tenantId: input.tenantId,
            equipmentId: input.equipmentId,
            reportDate: input.reportDate,
            shift: ShiftType.DAY,
          },
        },
        select: { status: true },
      });
      if (sameDayDay?.status) {
        return sameDayDay.status;
      }
    }

    const previous = await tx.equipmentAvailability.findFirst({
      where: {
        tenantId: input.tenantId,
        equipmentId: input.equipmentId,
        reportDate: { lt: input.reportDate },
      },
      select: { status: true },
      orderBy: [{ reportDate: 'desc' }, { createdAt: 'desc' }],
    });

    return previous?.status ?? null;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // EXISTING METHODS (unchanged)
  // ───────────────────────────────────────────────────────────────────────────

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

    // Resolve & validate shift outside the serializable transaction (no DB contention).
    const effectiveShift = await this.resolveShift(tenantId, dto.shift);

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

        const reportDate = this.normalizeReportDate(dto.reportDate);
        const previousStatus = await this.resolvePreviousAvailabilityStatus(tx, {
          tenantId,
          equipmentId: dto.equipmentId,
          reportDate,
          shift: effectiveShift,
        });

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
              reportDate,
              shift: effectiveShift,
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

        const operationalTransition =
          await this.operationalOrchestrator.onOperationalStatusChange(tx, {
            tenantId,
            equipmentId: dto.equipmentId,
            availabilityId: record.id,
            newStatus: dto.status,
            previousStatus,
            meterReading: dto.meterReading ?? null,
            comments: dto.comments ?? null,
            reportDate: dto.reportDate,
            reportedById: userId,
          });

        return {
          ...record,
          isAvailable: isAvailableStatus(record.status),
          operationalTransition,
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10_000,
        timeout: 30_000,
      },
    );
  }

  /**
   * Equipos activos sin reporte para el turno — paginado con búsqueda opcional.
   */
  async findUnreported(
    user: any,
    query: UnreportedQueryDto,
  ): Promise<PaginatedUnreportedResponse> {
    const tenantId = user.tenantId as string;
    const effectiveShift = await this.resolveShift(tenantId, query.shift);

    const reportDate = new Date(query.date);
    reportDate.setUTCHours(0, 0, 0, 0);

    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 25));

    const equipmentWhere = this.mergeEquipmentSearch(
      this.buildEquipmentScopeWhere(user, query.contractId),
      query.search,
    );

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
          type: true,
          currentMeter: true,
          meterType: true,
        },
        orderBy: { internalId: 'asc' },
      }),
      this.prisma.equipmentAvailability.findMany({
        where: { tenantId, reportDate, shift: effectiveShift },
        select: { equipmentId: true },
      }),
    ]);

    const reportedIds = new Set(reported.map((r) => r.equipmentId));
    const unreported = fleet.filter((e) => !reportedIds.has(e.id));
    const total = unreported.length;
    const skip = (page - 1) * pageSize;
    const data = unreported.slice(skip, skip + pageSize);

    return { data, total, page, pageSize };
  }

  /**
   * Tablero del turno para Monitor de Flota: KPIs + filas reportadas/pendientes/excluidas.
   */
  async getShiftBoard(
    user: any,
    query: ShiftBoardQueryDto,
  ): Promise<ShiftBoardResponse> {
    const tenantId = user.tenantId as string;
    const effectiveShift = await this.resolveShift(tenantId, query.shift);

    const reportDate = new Date(query.date);
    reportDate.setUTCHours(0, 0, 0, 0);

    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 25));
    const tab: ShiftBoardTab = query.tab ?? 'ALL';

    const equipmentWhere = this.mergeEquipmentSearch(
      this.buildEquipmentScopeWhere(user, query.contractId, {
        operationalOnly: false,
      }),
      query.search,
    );

    const [fleet, reports] = await Promise.all([
      this.prisma.equipment.findMany({
        where: equipmentWhere,
        select: {
          id: true,
          internalId: true,
          brand: true,
          model: true,
          plate: true,
          contractId: true,
          isOperational: true,
        },
        orderBy: { internalId: 'asc' },
      }),
      this.prisma.equipmentAvailability.findMany({
        where: { tenantId, reportDate, shift: effectiveShift },
        include: this.listInclude,
      }),
    ]);

    const fleetIds = new Set(fleet.map((e) => e.id));
    const reportsInScope = reports.filter((r) => fleetIds.has(r.equipmentId));
    const reportByEquipmentId = new Map(
      reportsInScope.map((r) => [r.equipmentId, r]),
    );

    const allRows: ShiftBoardRow[] = fleet.map((eq) => {
      const base = {
        equipmentId: eq.id,
        internalId: eq.internalId,
        brand: eq.brand,
        model: eq.model,
        plate: eq.plate,
        contractId: eq.contractId,
        isOperational: eq.isOperational,
      };

      if (!eq.isOperational) {
        return { ...base, rowKind: 'EXCLUDED' as const };
      }

      const report = reportByEquipmentId.get(eq.id);
      if (!report) {
        return { ...base, rowKind: 'PENDING' as const };
      }

      return {
        ...base,
        rowKind: 'REPORTED' as const,
        availabilityId: report.id,
        status: report.status,
        meterReading: report.meterReading,
        comments: report.comments,
        isAvailable: isAvailableStatus(report.status),
        reportedBy: report.reportedBy,
        reportedAt: report.createdAt.toISOString(),
      };
    });

    const operational = allRows.filter((r) => r.isOperational);
    const reportedOperational = operational.filter(
      (r) => r.rowKind === 'REPORTED',
    );
    const byStatus = this.emptyStatusCounts();
    for (const row of reportedOperational) {
      if (row.status) {
        byStatus[row.status]++;
      }
    }

    const totalFleet = operational.length;
    const reportedCount = reportedOperational.length;
    const unreportedCount = operational.filter(
      (r) => r.rowKind === 'PENDING',
    ).length;
    const excludedDownCount = allRows.filter(
      (r) => r.rowKind === 'EXCLUDED',
    ).length;
    const completionPct =
      totalFleet > 0 ? Math.round((reportedCount / totalFleet) * 100) : 100;

    const contractMap = new Map<
      string,
      { totalFleet: number; reportedCount: number; unreportedCount: number }
    >();
    for (const row of operational) {
      const key = row.contractId ?? '__none__';
      const entry = contractMap.get(key) ?? {
        totalFleet: 0,
        reportedCount: 0,
        unreportedCount: 0,
      };
      entry.totalFleet++;
      if (row.rowKind === 'REPORTED') entry.reportedCount++;
      if (row.rowKind === 'PENDING') entry.unreportedCount++;
      contractMap.set(key, entry);
    }
    const byContract = Array.from(contractMap.entries()).map(([key, v]) => ({
      contractId: key === '__none__' ? null : key,
      ...v,
    }));

    const summary: ShiftBoardSummary = {
      totalFleet,
      reportedCount,
      unreportedCount,
      excludedDownCount,
      completionPct,
      byStatus,
      byContract,
    };

    const filtered = this.filterShiftBoardTab(allRows, tab);
    const total = filtered.length;
    const skip = (page - 1) * pageSize;
    const rows = filtered.slice(skip, skip + pageSize);

    return {
      date: query.date,
      shift: effectiveShift,
      summary,
      rows,
      total,
      page,
      pageSize,
    };
  }

  /**
   * Creación masiva desde formulario web — éxito parcial por fila.
   */
  async batchCreate(
    dto: BatchCreateAvailabilityDto,
    user: any,
  ): Promise<ImportCommitResult> {
    const tenantId = user.tenantId as string;
    const effectiveShift = await this.resolveShift(tenantId, dto.shift);

    let committed = 0;
    const errors: ImportCommitResult['errors'] = [];
    const sideEffects: AvailabilitySideEffect[] = [];

    for (const row of dto.rows) {
      try {
        const transition = await this.upsertRow(
          {
            equipmentId: row.equipmentId,
            reportDate: dto.reportDate,
            shift: effectiveShift,
            status: row.status,
            meterReading: row.meterReading,
            comments: row.comments,
          },
          user,
        );
        if (transition) {
          sideEffects.push(toAvailabilitySideEffect(transition, row.status));
        }
        committed++;
      } catch (e) {
        const reason =
          e instanceof Error
            ? e.message
            : 'Error desconocido al guardar el registro.';
        errors.push({ equipmentId: row.equipmentId, reason });
      }
    }

    return {
      committed,
      errors,
      ...(sideEffects.length > 0 ? { sideEffects } : {}),
    };
  }

  /**
   * Historial paginado de reportes de disponibilidad por tenant.
   */
  async findAll(user: any, query: ListAvailabilityQuery = {}) {
    const tenantId = user.tenantId as string;
    const isAdmin = user.role === 'ADMIN' || user.role === 'SUPER_ADMIN';
    const allowedContracts = user.allowedContracts as string[] | undefined;

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

    const equipmentFilter: Prisma.EquipmentWhereInput = {};
    if (!isAdmin && allowedContracts?.length) {
      equipmentFilter.contractId = { in: allowedContracts };
    }
    if (query.contractId?.trim()) {
      equipmentFilter.contractId = query.contractId.trim();
    }
    const searchMerged = this.mergeEquipmentSearch(
      equipmentFilter,
      query.search,
    );
    if (Object.keys(searchMerged).length > 0) {
      where.equipment = searchMerged;
    }

    const [rows, total] = await Promise.all([
      this.prisma.equipmentAvailability.findMany({
        where,
        include: this.listInclude,
        orderBy: [
          { reportDate: 'desc' },
          { shift: 'asc' },
          { createdAt: 'desc' },
        ],
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

  // ───────────────────────────────────────────────────────────────────────────
  // EXCEL EXPORT
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Genera la plantilla `.xlsx` para el turno indicado.
   *
   * - Incluye TODA la flota operativa en el alcance del usuario.
   * - Pre-rellena las celdas de Estado/Horómetro/Observaciones si el equipo
   *   ya tiene un reporte para ese turno (caso UPDATE).
   * - La hoja de datos queda protegida con contraseña "tpm-import":
   *   columnas # y Placa están bloqueadas; Estado/Horómetro/Observaciones
   *   tienen protection.locked=false y validación de datos nativa de Excel.
   * - La hoja `_info` (veryHidden) embebe reportDate, shift y tenantId para
   *   validar el origen del archivo en el endpoint de importación.
   */
  async exportTemplate(
    query: ExportAvailabilityQueryDto,
    user: any,
  ): Promise<Buffer> {
    const tenantId = user.tenantId as string;
    const isAdmin = user.role === 'ADMIN' || user.role === 'SUPER_ADMIN';
    const allowedContracts = user.allowedContracts as string[] | undefined;

    // Resolve shift + load operational config (needed for sheet label with start time).
    const [effectiveShift, opConfig] = await Promise.all([
      this.resolveShift(tenantId, query.shift),
      this.getOperationalConfig(tenantId),
    ]);

    const reportDate = new Date(query.reportDate);
    reportDate.setUTCHours(0, 0, 0, 0);

    // ── 1. Load fleet + existing records in parallel ──────────────────────────
    const equipmentWhere: Prisma.EquipmentWhereInput = {
      tenantId,
      isOperational: true,
    };
    if (!isAdmin && allowedContracts?.length) {
      equipmentWhere.contractId = { in: allowedContracts };
    }
    if (query.contractId) {
      equipmentWhere.contractId = query.contractId;
    }

    const [fleet, existing] = await Promise.all([
      this.prisma.equipment.findMany({
        where: equipmentWhere,
        select: {
          id: true,
          internalId: true,
          brand: true,
          model: true,
          plate: true,
          currentMeter: true,
          meterType: true,
        },
        orderBy: [{ internalId: 'asc' }],
      }),
      this.prisma.equipmentAvailability.findMany({
        where: { tenantId, reportDate, shift: effectiveShift },
        select: {
          equipmentId: true,
          status: true,
          meterReading: true,
          comments: true,
        },
      }),
    ]);

    // ── Load last meter log date per equipment (for tooltip hint) ─────────────
    // Query all meter logs for the fleet, ordered desc — then keep first per id.
    const fleetIds = fleet.map((e) => e.id);
    const recentLogs = await this.prisma.equipmentMeterLog.findMany({
      where: { tenantId, equipmentId: { in: fleetIds } },
      select: { equipmentId: true, date: true },
      orderBy: { date: 'desc' },
    });
    const lastLogMap = new Map<string, Date>();
    for (const log of recentLogs) {
      if (!lastLogMap.has(log.equipmentId)) {
        lastLogMap.set(log.equipmentId, log.date);
      }
    }

    const existingMap = new Map(existing.map((r) => [r.equipmentId, r]));

    // ── 2. Build workbook ─────────────────────────────────────────────────────
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'BaseLogic TPM';
    workbook.created = new Date();

    const shiftLabel = effectiveShift === 'DAY' ? 'Día' : 'Noche';
    const shiftStartTime =
      effectiveShift === 'DAY'
        ? opConfig.dayShiftStartTime
        : opConfig.nightShiftStartTime;
    const ws = workbook.addWorksheet(
      sanitizeExcelWorksheetName(
        `Disponibilidad ${shiftLabel} (${shiftStartTime})`,
      ),
      {
        pageSetup: { paperSize: 9, orientation: 'landscape' },
      },
    );

    // ── 2a. Column widths ────────────────────────────────────────────────────
    ws.columns = [
      { key: 'num', width: 5 },
      { key: 'equip', width: 38 },
      { key: 'status', width: 27 },
      { key: 'meter', width: 28 },
      { key: 'comments', width: 45 },
      { key: 'eqid', width: 8 },
    ];
    ws.getColumn(6).hidden = true;

    // ── 2b. Dynamic column header depending on fleet meter types ─────────────
    const meterTypes = new Set(fleet.map((e) => e.meterType));
    const meterColHeader =
      meterTypes.size === 1 && meterTypes.has('HOURS')
        ? 'Horómetro (horas enteras, ej: 12450)'
        : meterTypes.size === 1 && meterTypes.has('KILOMETERS')
          ? 'Odómetro (km enteros, ej: 125000)'
          : 'Medidor (horas o km — ver tooltip de cada fila)';

    const headers = [
      '#',
      'Placa / ID Interno',
      'Estado Operativo *',
      meterColHeader,
      'Observaciones',
      '_eq_id',
    ];
    const headerRow = ws.addRow(headers);
    headerRow.eachCell((cell) => {
      cell.fill = HEADER_FILL;
      cell.font = HEADER_FONT;
      cell.border = {
        bottom: { style: 'thin', color: { argb: 'FF00B4D8' } },
      };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
    });
    headerRow.height = 22;

    // ── 2c. Data rows ────────────────────────────────────────────────────────
    fleet.forEach((eq, idx) => {
      const rec = existingMap.get(eq.id);
      const label = [eq.plate, eq.brand, eq.model, `(${eq.internalId})`]
        .filter(Boolean)
        .join(' · ');

      const dataRow = ws.addRow([
        idx + 1,
        label,
        rec ? EXCEL_STATUS_LABELS[rec.status] : null,
        rec?.meterReading ?? null,
        rec?.comments ?? null,
        eq.id,
      ]);
      dataRow.height = 20;
      dataRow.font = ROW_FONT;
      dataRow.alignment = { vertical: 'middle' };

      // Locked cells: # and Placa
      dataRow.getCell(1).fill = LOCKED_FILL;
      dataRow.getCell(2).fill = LOCKED_FILL;
      dataRow.getCell(6).fill = LOCKED_FILL;

      // Editable cells: unlock BEFORE sheet.protect()
      const editableIndexes = [3, 4, 5];
      for (const ci of editableIndexes) {
        const cell = dataRow.getCell(ci);
        cell.fill = EDITABLE_FILL;
        cell.style = { ...cell.style, protection: { locked: false } };
      }

      // Data validation — Estado column (C)
      dataRow.getCell(3).dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: [`"${STATUS_DROPDOWN}"`],
        showErrorMessage: true,
        errorTitle: 'Estado inválido',
        error: `Selecciona una opción de la lista desplegable. Opciones: ${STATUS_DROPDOWN}`,
        showInputMessage: true,
        promptTitle: 'Estado Operativo',
        prompt: 'Selecciona el estado del equipo en este turno.',
      };

      // Data validation — Horómetro / Odómetro column (D)
      // Tooltip is personalized per row: unit, current value, and date of last log.
      const isKm = eq.meterType === 'KILOMETERS';
      const unit = isKm ? 'km' : 'hrs';
      const meterLabel = isKm ? 'Odómetro' : 'Horómetro';
      const example = isKm ? '125000' : '12450';

      const lastLogDate = lastLogMap.get(eq.id);
      const lastLogStr = lastLogDate
        ? lastLogDate.toLocaleString('es-CL', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'UTC',
          })
        : null;

      const currentStr =
        eq.currentMeter > 0
          ? `${eq.currentMeter.toLocaleString('es-CL')} ${unit}`
          : `0 ${unit}`;

      const lastReadingLine = lastLogStr
        ? `Última lectura: ${currentStr}  (${lastLogStr})`
        : `Última lectura registrada: ${currentStr}  (sin fecha en log)`;

      dataRow.getCell(4).dataValidation = {
        type: 'whole',
        operator: 'greaterThanOrEqual',
        formulae: [1],
        allowBlank: true,
        showErrorMessage: true,
        errorStyle: 'warning',
        errorTitle: `${meterLabel} inválido`,
        error:
          `Ingresa solo el número de ${unit} (entero ≥ 1), sin texto ni unidades.\n` +
          `Ejemplo: ${example}\nSi no tienes la lectura, deja la celda vacía.`,
        showInputMessage: true,
        promptTitle: `${meterLabel} — ${lastReadingLine}`,
        prompt:
          `${lastReadingLine}\n\n` +
          `Ingresa el valor actual en ${unit} (número entero).\n` +
          `Ej: ${example}  ·  Deja vacío si no tienes la lectura.`,
      };

      // Alignment
      dataRow.getCell(1).alignment = {
        horizontal: 'center',
        vertical: 'middle',
      };
      dataRow.getCell(4).alignment = {
        horizontal: 'right',
        vertical: 'middle',
      };
    });

    // ── 2d. Freeze header row + autofilter ────────────────────────────────────
    ws.views = [{ state: 'frozen', ySplit: 1, xSplit: 0 }];
    ws.autoFilter = { from: 'A1', to: 'E1' };

    // ── 2e. Sheet protection (call AFTER setting protection.locked = false) ───
    // ExcelJS uses bcrypt for the password hash — protect() returns Promise<string>.
    await ws.protect('tpm-import', {
      selectLockedCells: true,
      selectUnlockedCells: true,
      formatCells: false,
      insertRows: false,
      deleteRows: false,
      sort: false,
      autoFilter: false,
    });

    // ── 3. Hidden _info sheet ─────────────────────────────────────────────────
    // Stores context for validation on import + a sorted list of expected
    // equipment IDs so we can detect rows added/removed after export.
    const infoSheet = workbook.addWorksheet('_info');
    infoSheet.state = 'veryHidden';
    infoSheet.getCell('A1').value = 'reportDate';
    infoSheet.getCell('B1').value = query.reportDate;
    infoSheet.getCell('A2').value = 'shift';
    infoSheet.getCell('B2').value = effectiveShift;
    infoSheet.getCell('A3').value = 'tenantId';
    infoSheet.getCell('B3').value = tenantId;
    infoSheet.getCell('A4').value = 'generatedAt';
    infoSheet.getCell('B4').value = new Date().toISOString();
    infoSheet.getCell('A5').value = 'equipmentCount';
    infoSheet.getCell('B5').value = fleet.length;
    // Row 6+: one row per equipment — id | currentMeter (for import-time reference)
    fleet.forEach((eq, i) => {
      infoSheet.getCell(`A${6 + i}`).value = eq.id;
      infoSheet.getCell(`B${6 + i}`).value = eq.currentMeter;
    });

    // ── 4. Return buffer ──────────────────────────────────────────────────────
    // ExcelJS v4 Buffer typedef predates Node's Buffer<ArrayBufferLike>; cast via unknown.
    const raw = await workbook.xlsx.writeBuffer();
    return raw as unknown as Buffer;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // EXCEL IMPORT — PHASE 1: VALIDATE (dry-run, no DB writes)
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Parsea el archivo `.xlsx` subido, valida cada fila y determina la acción
   * correspondiente (CREATE / UPDATE / SKIP / ERROR) sin escribir en la DB.
   *
   * El contexto del turno (reportDate, shift, tenantId) se extrae de la hoja
   * `_info` embebida en la plantilla, evitando ambigüedades de parámetros.
   *
   * Validaciones inteligentes aplicadas:
   *  1. Firma de plantilla: presencia de hoja `_info` con tenantId correcto.
   *  2. Integridad del archivo: conteo de equipos exportados vs importados.
   *  3. equipmentId duplicado en el archivo (misma fila dos veces).
   *  4. Estado inválido o vacío — incluyendo normalización de espacios/case.
   *  5. Horómetro: parsing robusto ("12.450", "12,450", "12450 hrs" → 12450).
   *  6. Horómetro vacío en celda que parece tener texto (error de formato).
   *  7. Advertencia (no error) cuando meter < currentMeter del equipo en DB.
   *
   * @returns JSON de previsualización listo para que el frontend dibuje la
   *          tabla de confirmación antes de llamar a `commitImport`.
   */
  async validateImport(
    buffer: Buffer,
    user: any,
  ): Promise<ImportValidationResult> {
    const tenantId = user.tenantId as string;
    const isAdmin = user.role === 'ADMIN' || user.role === 'SUPER_ADMIN';
    const allowedContracts = user.allowedContracts as string[] | undefined;

    // ── 1. Parse Excel ────────────────────────────────────────────────────────
    let workbook: ExcelJS.Workbook;
    try {
      workbook = new ExcelJS.Workbook();
      // Cast needed: ExcelJS v4 Buffer typedef differs from Node's Buffer<ArrayBufferLike>
      await workbook.xlsx.load(
        buffer as unknown as Parameters<typeof workbook.xlsx.load>[0],
      );
    } catch {
      throw new BadRequestException(
        'El archivo no es un Excel válido (.xlsx). Descarga la plantilla desde el sistema.',
      );
    }

    // ── 2. Verify _info sheet — template identity + tenant check ─────────────
    const infoSheet = workbook.getWorksheet('_info');
    if (!infoSheet) {
      throw new BadRequestException(
        'El archivo no es una plantilla de disponibilidad de BaseLogic TPM. ' +
          'Usa el botón "Descargar Plantilla" para obtener un archivo válido.',
      );
    }

    const storedReportDate = cellStr(infoSheet.getCell('B1').value).trim();
    const storedShift = cellStr(
      infoSheet.getCell('B2').value,
    ).trim() as ShiftType;
    const storedTenantId = cellStr(infoSheet.getCell('B3').value).trim();
    const storedEquipmentCount = Number(
      cellStr(infoSheet.getCell('B5').value).trim(),
    );

    if (storedTenantId !== tenantId) {
      throw new BadRequestException(
        'El archivo fue generado para otra empresa. ' +
          'Descarga la plantilla usando tu cuenta activa.',
      );
    }
    if (!storedReportDate || !storedShift) {
      throw new BadRequestException(
        'La plantilla no contiene metadatos de turno válidos. ' +
          'Descarga una nueva plantilla.',
      );
    }
    // Sin turno noche: plantillas antiguas con NIGHT se tratan como DAY.
    let effectiveStoredShift = storedShift;
    if (storedShift === ShiftType.NIGHT) {
      const opConfig = await this.getOperationalConfig(tenantId);
      if (!opConfig.hasNightShift) {
        effectiveStoredShift = ShiftType.DAY;
      }
    }

    // Read per-equipment currentMeter map stored in _info (row 6+)
    const infoMeterMap = new Map<string, number>();
    let infoRow = 6;
    while (true) {
      const eqId = cellStr(infoSheet.getCell(`A${infoRow}`).value).trim();
      if (!eqId) break;
      const meter = Number(
        cellStr(infoSheet.getCell(`B${infoRow}`).value).trim(),
      );
      if (eqId) infoMeterMap.set(eqId, isFinite(meter) ? meter : 0);
      infoRow++;
    }

    // ── 3. Load fleet + existing records for this shift in parallel ───────────
    const reportDate = new Date(storedReportDate);
    reportDate.setUTCHours(0, 0, 0, 0);

    const equipmentWhere: Prisma.EquipmentWhereInput = { tenantId };
    if (!isAdmin && allowedContracts?.length) {
      equipmentWhere.contractId = { in: allowedContracts };
    }

    const [fleet, existingRecords] = await Promise.all([
      this.prisma.equipment.findMany({
        where: equipmentWhere,
        select: {
          id: true,
          internalId: true,
          brand: true,
          model: true,
          plate: true,
          currentMeter: true,
          meterType: true,
        },
      }),
      this.prisma.equipmentAvailability.findMany({
        where: { tenantId, reportDate, shift: effectiveStoredShift },
        select: {
          equipmentId: true,
          status: true,
          meterReading: true,
          comments: true,
        },
      }),
    ]);

    const fleetMap = new Map(fleet.map((e) => [e.id, e]));
    const existingMap = new Map(existingRecords.map((r) => [r.equipmentId, r]));

    // ── 4. Parse data rows ────────────────────────────────────────────────────
    const dataSheet = workbook.worksheets[0];
    if (!dataSheet) {
      throw new BadRequestException('La plantilla no contiene hoja de datos.');
    }

    const rows: ImportRowPreview[] = [];
    const seenEquipmentIds = new Set<string>(); // duplicate detection

    dataSheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return; // skip header

      const rawEqId = row.getCell(6).value;
      const rawStatus = row.getCell(3).value;
      const rawMeter = row.getCell(4).value;
      const rawComments = row.getCell(5).value;

      const equipmentId = rawEqId ? cellStr(rawEqId).trim() : null;
      if (!equipmentId) return; // truly blank row — skip silently

      // Normalize status: trim whitespace and normalize to the expected label
      const statusRaw = rawStatus ? cellStr(rawStatus).trim() : null;
      // Normalize: collapse multiple spaces, try case-insensitive match as fallback
      const statusNormalized = statusRaw
        ? statusRaw.replace(/\s+/g, ' ')
        : null;
      const statusLabelMatch =
        statusNormalized != null
          ? EXCEL_STATUS_MAP[statusNormalized] != null
            ? statusNormalized
            : // Case-insensitive fallback
              (Object.keys(EXCEL_STATUS_MAP).find(
                (k) => k.toLowerCase() === statusNormalized.toLowerCase(),
              ) ?? null)
          : null;

      const rawCommentsStr = cellStr(rawComments).trim();
      const comments = rawCommentsStr || null;

      // Use the robust meter parser for the read value
      const meterReading = parseMeterValue(rawMeter);
      // Detect if cell had text that is not a valid number (non-blank, parse failed)
      const rawMeterStr = rawMeter != null ? cellStr(rawMeter).trim() : '';
      const meterHadText =
        rawMeterStr !== '' && meterReading === null && rawMeter != null;

      const equipment = fleetMap.get(equipmentId);
      const currentMeterInDb = equipment?.currentMeter ?? null;
      const meterUnit: 'hrs' | 'km' =
        equipment?.meterType === 'KILOMETERS' ? 'km' : 'hrs';

      const label = equipment
        ? [
            equipment.plate,
            equipment.brand,
            equipment.model,
            `(${equipment.internalId})`,
          ]
            .filter(Boolean)
            .join(' · ')
        : equipmentId;

      // ── Validate: equipment must be in tenant scope ──────────────────────
      if (!equipment) {
        rows.push({
          rowNum: rowNumber,
          equipmentId,
          equipmentLabel: label,
          status: null,
          statusLabel: statusRaw ?? '',
          meterReading: null,
          comments,
          action: 'ERROR',
          currentStatus: null,
          currentMeter: null,
          meterUnit,
          warning: null,
          error:
            'Equipo no encontrado. Puede que la fila se haya agregado manualmente ' +
            'o que el equipo no pertenezca a tu contrato.',
        });
        return;
      }

      // ── Validate: no duplicate equipmentId in the same file ─────────────
      if (seenEquipmentIds.has(equipmentId)) {
        rows.push({
          rowNum: rowNumber,
          equipmentId,
          equipmentLabel: label,
          status: null,
          statusLabel: statusRaw ?? '',
          meterReading,
          comments,
          action: 'ERROR',
          currentStatus: existingMap.get(equipmentId)?.status ?? null,
          currentMeter: currentMeterInDb,
          meterUnit,
          warning: null,
          error:
            'Este equipo aparece más de una vez en el archivo. ' +
            'Elimina la fila duplicada y vuelve a subir.',
        });
        return;
      }
      seenEquipmentIds.add(equipmentId);

      // ── Validate: status must be a recognized label ──────────────────────
      const status = statusLabelMatch
        ? (EXCEL_STATUS_MAP[statusLabelMatch] ?? null)
        : null;
      if (!status) {
        rows.push({
          rowNum: rowNumber,
          equipmentId,
          equipmentLabel: label,
          status: null,
          statusLabel: statusRaw ?? '',
          meterReading,
          comments,
          action: 'ERROR',
          currentStatus: existingMap.get(equipmentId)?.status ?? null,
          currentMeter: currentMeterInDb,
          meterUnit,
          warning: null,
          error: statusRaw
            ? `Estado no reconocido: "${statusRaw}". ` +
              'Usa el menú desplegable de la plantilla — no escribas el texto a mano.'
            : 'El campo "Estado Operativo" es obligatorio. Selecciona un valor del desplegable.',
        });
        return;
      }

      // ── Validate: meter value format ─────────────────────────────────────
      if (meterHadText) {
        const meterLabelStr =
          equipment.meterType === 'KILOMETERS' ? 'Odómetro' : 'Horómetro';
        const exampleStr =
          equipment.meterType === 'KILOMETERS' ? '125000' : '12450';
        rows.push({
          rowNum: rowNumber,
          equipmentId,
          equipmentLabel: label,
          status,
          statusLabel: EXCEL_STATUS_LABELS[status],
          meterReading: null,
          comments,
          action: 'ERROR',
          currentStatus: existingMap.get(equipmentId)?.status ?? null,
          currentMeter: currentMeterInDb,
          meterUnit,
          warning: null,
          error:
            `${meterLabelStr} inválido: "${rawMeterStr}". ` +
            `Ingresa solo el número en ${meterUnit} sin texto (ej: ${exampleStr}). ` +
            'Si no tienes la lectura, deja la celda vacía.',
        });
        return;
      }

      // ── Build non-blocking warning if meter reading goes backwards ───────
      let warning: string | null = null;
      if (
        meterReading !== null &&
        currentMeterInDb !== null &&
        meterReading < currentMeterInDb
      ) {
        const meterLabelStr =
          equipment.meterType === 'KILOMETERS' ? 'Odómetro' : 'Horómetro';
        warning =
          `${meterLabelStr} menor al actual ` +
          `(${meterReading.toLocaleString('es-CL')} < ` +
          `${currentMeterInDb.toLocaleString('es-CL')} ${meterUnit}). ` +
          'El registro se guardará pero el medidor del equipo NO retrocederá.';
      }

      // ── Determine action: CREATE / UPDATE / SKIP ─────────────────────────
      const existingRec = existingMap.get(equipmentId);
      let action: ImportRowAction;
      if (!existingRec) {
        action = 'CREATE';
      } else {
        const sameStatus = existingRec.status === status;
        const sameMeter =
          (meterReading == null && existingRec.meterReading == null) ||
          meterReading === existingRec.meterReading;
        const sameComments =
          (comments ?? null) === (existingRec.comments ?? null);
        action = sameStatus && sameMeter && sameComments ? 'SKIP' : 'UPDATE';
      }

      rows.push({
        rowNum: rowNumber,
        equipmentId,
        equipmentLabel: label,
        status,
        statusLabel: EXCEL_STATUS_LABELS[status],
        meterReading,
        comments,
        action,
        currentStatus: existingRec?.status ?? null,
        currentMeter: currentMeterInDb,
        meterUnit,
        warning,
        error: null,
      });
    });

    // ── 5. Cross-check row count vs _info equipmentCount ─────────────────────
    // Warn if the number of equipment rows differs from what was exported.
    // This detects rows added/deleted from the file manually.
    const actualDataRows = rows.length;
    const countMismatch =
      isFinite(storedEquipmentCount) &&
      storedEquipmentCount > 0 &&
      actualDataRows !== storedEquipmentCount;

    // If rows were added beyond what the template had, error the extras (already
    // handled above via fleetSet miss). If rows are missing, add a global warning
    // row so the user sees it clearly.
    let missingEquipmentWarning: string | null = null;
    if (countMismatch && actualDataRows < storedEquipmentCount) {
      missingEquipmentWarning =
        `El archivo tiene ${actualDataRows} equipos pero la plantilla original ` +
        `contenía ${storedEquipmentCount}. Es posible que se hayan eliminado filas. ` +
        'Los equipos faltantes quedarán sin reporte.';
    }

    // ── 6. Build summary ──────────────────────────────────────────────────────
    const summary = {
      total: rows.length,
      toCreate: rows.filter((r) => r.action === 'CREATE').length,
      toUpdate: rows.filter((r) => r.action === 'UPDATE').length,
      withErrors: rows.filter((r) => r.action === 'ERROR').length,
      toSkip: rows.filter((r) => r.action === 'SKIP').length,
      withWarnings: rows.filter((r) => r.warning !== null).length,
    };

    return {
      reportDate: storedReportDate,
      shift: effectiveStoredShift,
      rows,
      summary,
      ...(missingEquipmentWarning
        ? { globalWarning: missingEquipmentWarning }
        : {}),
    } as ImportValidationResult & { globalWarning?: string };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // EXCEL IMPORT — PHASE 2: COMMIT (sequential upsert loop)
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Persiste las filas validadas en la DB mediante upsert fila por fila.
   *
   * Política de éxito parcial:
   *   - Cada fila tiene su propia transacción Serializable.
   *   - Un error en una fila NO cancela las anteriores.
   *   - Se retorna { committed, errors } al final del lote.
   *
   * El frontend debe enviar SOLO las filas con action === 'CREATE' | 'UPDATE'.
   */
  async commitImport(
    dto: ImportAvailabilityCommitDto,
    user: any,
  ): Promise<ImportCommitResult> {
    const tenantId = user.tenantId as string;
    const effectiveShift = await this.resolveShift(tenantId, dto.shift);

    let committed = 0;
    const errors: ImportCommitResult['errors'] = [];
    const sideEffects: AvailabilitySideEffect[] = [];

    for (const row of dto.rows) {
      try {
        const transition = await this.upsertRow(
          {
            equipmentId: row.equipmentId,
            reportDate: dto.reportDate,
            shift: effectiveShift,
            status: row.status,
            meterReading: row.meterReading,
            comments: row.comments,
          },
          user,
        );
        if (transition) {
          sideEffects.push(toAvailabilitySideEffect(transition, row.status));
        }
        committed++;
      } catch (e) {
        const reason =
          e instanceof Error
            ? e.message
            : 'Error desconocido al guardar el registro.';
        errors.push({ equipmentId: row.equipmentId, reason });
      }
    }

    return {
      committed,
      errors,
      ...(sideEffects.length > 0 ? { sideEffects } : {}),
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // PRIVATE HELPERS
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Upsert de un registro de disponibilidad dentro de una transacción Serializable.
   *
   * - Reutiliza la misma lógica de horómetro que `create()`:
   *   avanza el medidor solo si meterReading > equipment.currentMeter (silent-skip
   *   si el valor no avanza — lectura tardía o corrección del supervisor).
   * - Aplica tanto a INSERT nuevo (CREATE) como a actualización (UPDATE).
   */
  private async upsertRow(
    dto: {
      equipmentId: string;
      reportDate: string;
      shift: ShiftType;
      status: OperationalStatus;
      meterReading?: number | null;
      comments?: string | null;
    },
    user: any,
  ): Promise<OperationalTransitionResult | null> {
    const tenantId = user.tenantId as string;
    const userId = (user.id ?? user.sub) as string;

    return this.prisma.$transaction(
      async (tx) => {
        const equipment = await tx.equipment.findFirst({
          where: { id: dto.equipmentId, tenantId },
          select: { id: true, currentMeter: true, contractId: true },
        });
        if (!equipment) {
          throw new NotFoundException(
            `El equipo ${dto.equipmentId} no existe o no pertenece a este tenant.`,
          );
        }

        const reportDate = this.normalizeReportDate(dto.reportDate);

        const existing = await tx.equipmentAvailability.findUnique({
          where: {
            tenantId_equipmentId_reportDate_shift: {
              tenantId,
              equipmentId: dto.equipmentId,
              reportDate,
              shift: dto.shift,
            },
          },
          select: { status: true },
        });
        const previousStatus = await this.resolvePreviousAvailabilityStatus(tx, {
          tenantId,
          equipmentId: dto.equipmentId,
          reportDate,
          shift: dto.shift,
          currentStatus: existing?.status ?? null,
        });

        const record = await tx.equipmentAvailability.upsert({
          where: {
            tenantId_equipmentId_reportDate_shift: {
              tenantId,
              equipmentId: dto.equipmentId,
              reportDate,
              shift: dto.shift,
            },
          },
          create: {
            tenantId,
            contractId: equipment.contractId ?? null,
            equipmentId: dto.equipmentId,
            reportedById: userId,
            reportDate,
            shift: dto.shift,
            status: dto.status,
            meterReading: dto.meterReading ?? null,
            comments: dto.comments ?? null,
          },
          update: {
            status: dto.status,
            meterReading: dto.meterReading ?? null,
            comments: dto.comments ?? null,
            reportedById: userId,
          },
        });

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

        return this.operationalOrchestrator.onOperationalStatusChange(tx, {
          tenantId,
          equipmentId: dto.equipmentId,
          availabilityId: record.id,
          newStatus: dto.status,
          previousStatus,
          meterReading: dto.meterReading ?? null,
          comments: dto.comments ?? null,
          reportDate: dto.reportDate,
          reportedById: userId,
        });
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10_000,
        timeout: 30_000,
      },
    );
  }
}
