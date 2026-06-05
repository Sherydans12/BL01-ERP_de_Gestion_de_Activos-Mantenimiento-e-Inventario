import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { isAvailableStatus } from '../equipment-availability/equipment-availability.service';
import type {
  KpiDashboardResponse,
  LubeTrendMonthPoint,
} from './kpi-dashboard.types';

const SHIFT_HOURS = 12;
const CACHE_TTL_MS = 60_000;

const LITER_ABBREVS = new Set(['LT', 'L', 'LTR', 'LTS', 'LIT', 'LITRO', 'LITROS']);

function hoursBetween(a: Date, b: Date): number {
  return Math.abs(b.getTime() - a.getTime()) / 3_600_000;
}

function clipHours(
  start: Date,
  end: Date,
  rangeStart: Date,
  rangeEnd: Date,
): number {
  const s = Math.max(start.getTime(), rangeStart.getTime());
  const e = Math.min(end.getTime(), rangeEnd.getTime());
  if (e <= s) return 0;
  return (e - s) / 3_600_000;
}

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function isLiterAbbrev(abbrev: string | null | undefined): boolean {
  if (!abbrev) return true;
  return LITER_ABBREVS.has(abbrev.trim().toUpperCase());
}

type KpiUser = {
  tenantId: string;
  id?: string;
  role?: string;
  allowedContracts?: string[];
};

@Injectable()
export class KpiAnalyticsService {
  private readonly cache = new Map<
    string,
    { expiresAt: number; payload: KpiDashboardResponse }
  >();

  constructor(private readonly prisma: PrismaService) {}

  /** Invalida caché del tenant (p. ej. tras mutaciones operativas). */
  invalidateTenantCache(tenantId: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${tenantId}:`)) {
        this.cache.delete(key);
      }
    }
  }

  async getKpiDashboard(
    user: KpiUser,
    fromRaw: string,
    toRaw: string,
    activeContract?: string,
  ): Promise<KpiDashboardResponse> {
    const from = new Date(fromRaw);
    const to = new Date(toRaw);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new BadRequestException('Rango de fechas inválido');
    }
    const rangeEnd = new Date(to);
    rangeEnd.setHours(23, 59, 59, 999);

    const cacheKey = `${user.tenantId}:${user.id ?? 'anon'}:${fromRaw}:${toRaw}:${activeContract ?? 'ALL'}`;
    const hit = this.cache.get(cacheKey);
    if (hit && hit.expiresAt > Date.now()) {
      return { ...hit.payload, meta: { ...hit.payload.meta, cached: true } };
    }

    const payload = await this.computeDashboard(
      user,
      from,
      rangeEnd,
      activeContract,
    );
    this.cache.set(cacheKey, {
      expiresAt: Date.now() + CACHE_TTL_MS,
      payload,
    });
    return payload;
  }

  private equipmentAccessWhere(
    user: KpiUser,
    activeContract?: string,
  ): Prisma.EquipmentWhereInput | undefined {
    if (user.role === 'ADMIN' || user.role === 'SUPER_ADMIN') {
      if (activeContract && activeContract !== 'ALL') {
        return {
          OR: [
            { contractId: activeContract },
            { subcontract: { contractId: activeContract } },
          ],
        };
      }
      return undefined;
    }
    const allowed = user.allowedContracts ?? [];
    return {
      OR: [
        { contractId: { in: allowed } },
        { subcontract: { contractId: { in: allowed } } },
      ],
    };
  }

  private async computeDashboard(
    user: KpiUser,
    from: Date,
    rangeEnd: Date,
    activeContract?: string,
  ): Promise<KpiDashboardResponse> {
    const tenantId = user.tenantId;
    const eqFilter = this.equipmentAccessWhere(user, activeContract);
    const equipmentScope = eqFilter ? { equipment: eqFilter } : {};

    const [
      statusGroups,
      otsInPeriod,
      criticalFaults,
      lubeReports,
      meterLogs,
    ] = await Promise.all([
      this.prisma.equipmentAvailability.groupBy({
        by: ['status'],
        where: {
          tenantId,
          reportDate: { gte: from, lte: rangeEnd },
          ...equipmentScope,
        },
        _count: { _all: true },
      }),
      this.prisma.workOrder.findMany({
        where: {
          tenantId,
          status: 'CLOSED',
          closedAt: { gte: from, lte: rangeEnd },
          ...equipmentScope,
        },
        select: {
          maintenanceType: true,
          detentionStartedAt: true,
          detentionEndedAt: true,
        },
      }),
      this.prisma.faultReport.findMany({
        where: {
          tenantId,
          criticality: 'HIGH',
          eventDate: { gte: from, lte: rangeEnd },
          ...equipmentScope,
        },
        select: { equipmentId: true, eventDate: true },
        orderBy: { eventDate: 'asc' },
      }),
      this.prisma.lubeReport.findMany({
        where: {
          tenantId,
          dispatchDate: { gte: from, lte: rangeEnd },
          ...(activeContract && activeContract !== 'ALL'
            ? { contractId: activeContract }
            : eqFilter
              ? { equipment: eqFilter }
              : {}),
        },
        select: {
          dispatchDate: true,
          lines: {
            select: {
              quantity: true,
              item: {
                select: { unitOfMeasure: { select: { abbreviation: true } } },
              },
            },
          },
        },
      }),
      this.prisma.equipmentMeterLog.findMany({
        where: {
          tenantId,
          date: { gte: from, lte: rangeEnd },
          ...equipmentScope,
        },
        select: { date: true, oldValue: true, newValue: true },
      }),
    ]);

    let reportedShifts = 0;
    let operationalShifts = 0;
    for (const row of statusGroups) {
      const count = row._count._all;
      reportedShifts += count;
      if (isAvailableStatus(row.status)) {
        operationalShifts += count;
      }
    }

    const totalShiftHours = reportedShifts * SHIFT_HOURS;
    const operationalShiftHours = operationalShifts * SHIFT_HOURS;
    const physicalAvailabilityPct =
      reportedShifts > 0
        ? Math.round((operationalShifts / reportedShifts) * 1000) / 10
        : null;

    const correctiveDurations: number[] = [];
    for (const ot of otsInPeriod) {
      if (
        ot.maintenanceType !== 'CORRECTIVO' ||
        !ot.detentionStartedAt ||
        !ot.detentionEndedAt
      ) {
        continue;
      }
      const h = clipHours(
        ot.detentionStartedAt,
        ot.detentionEndedAt,
        from,
        rangeEnd,
      );
      if (h > 0) correctiveDurations.push(h);
    }
    const totalRepairHours = correctiveDurations.reduce((a, b) => a + b, 0);
    const mttrHours =
      correctiveDurations.length > 0
        ? Math.round((totalRepairHours / correctiveDurations.length) * 100) /
          100
        : null;

    const byEqFaults = new Map<string, { eventDate: Date }[]>();
    for (const f of criticalFaults) {
      const list = byEqFaults.get(f.equipmentId) ?? [];
      list.push({ eventDate: f.eventDate });
      byEqFaults.set(f.equipmentId, list);
    }
    const mtbfIntervals: number[] = [];
    for (const [, rows] of byEqFaults) {
      const sorted = [...rows].sort(
        (a, b) => a.eventDate.getTime() - b.eventDate.getTime(),
      );
      for (let i = 1; i < sorted.length; i++) {
        mtbfIntervals.push(
          Math.max(0, hoursBetween(sorted[i - 1].eventDate, sorted[i].eventDate)),
        );
      }
    }
    const mtbfHours =
      mtbfIntervals.length > 0
        ? Math.round(
            (mtbfIntervals.reduce((a, b) => a + b, 0) / mtbfIntervals.length) *
              100,
          ) / 100
        : null;

    const lubeByMonth = new Map<string, number>();
    for (const report of lubeReports) {
      const key = monthKey(report.dispatchDate);
      let liters = lubeByMonth.get(key) ?? 0;
      for (const line of report.lines) {
        const abbrev = line.item.unitOfMeasure?.abbreviation;
        if (isLiterAbbrev(abbrev)) {
          liters += Number(line.quantity) || 0;
        }
      }
      lubeByMonth.set(key, liters);
    }

    const hoursByMonth = new Map<string, number>();
    for (const log of meterLogs) {
      const delta = Number(log.newValue) - Number(log.oldValue);
      if (!Number.isFinite(delta) || delta <= 0) continue;
      const key = monthKey(log.date);
      hoursByMonth.set(key, (hoursByMonth.get(key) ?? 0) + delta);
    }

    const allMonths = new Set([...lubeByMonth.keys(), ...hoursByMonth.keys()]);
    const lubeTrendMonthly: LubeTrendMonthPoint[] = [...allMonths]
      .sort()
      .map((month) => {
        const totalLiters = Math.round((lubeByMonth.get(month) ?? 0) * 100) / 100;
        const machineHours =
          Math.round((hoursByMonth.get(month) ?? 0) * 100) / 100;
        return {
          month,
          totalLiters,
          machineHours,
          litersPerMachineHour:
            machineHours > 0
              ? Math.round((totalLiters / machineHours) * 1000) / 1000
              : null,
        };
      });

    return {
      period: {
        from: from.toISOString().slice(0, 10),
        to: rangeEnd.toISOString().slice(0, 10),
      },
      contractId: activeContract ?? null,
      kpis: {
        physicalAvailabilityPct,
        mttrHours,
        mtbfHours,
      },
      physicalAvailability: {
        operationalShiftHours,
        totalShiftHours,
        reportedShifts,
        operationalShifts,
      },
      mttr: {
        correctiveOtCount: correctiveDurations.length,
        totalRepairHours: Math.round(totalRepairHours * 100) / 100,
      },
      mtbf: {
        criticalFaultCount: criticalFaults.length,
        intervalCount: mtbfIntervals.length,
      },
      lubeTrendMonthly,
      meta: {
        cached: false,
        generatedAt: new Date().toISOString(),
      },
    };
  }
}
