import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import Decimal from 'decimal.js';
import {
  computePmProjection,
  pmIntervalSourceLabel,
  type PmIntervalSource,
  type EquipmentPmInput,
} from './pm-interval';
import { generateWorkOrderManagementMonthlyPdfBuffer } from './work-order-management-monthly-pdf.generator';
import { equipmentDisplayLabel } from './equipment-display-label';

const INTERVENTION_KEYS = [
  'electric',
  'mechanical',
  'hydraulic',
  'pneumatic',
  'structural',
  'wheels',
  'others',
] as const;

const INTERVENTION_LABELS: Record<(typeof INTERVENTION_KEYS)[number], string> =
  {
    electric: 'Eléctrico',
    mechanical: 'Mecánico',
    hydraulic: 'Hidráulico',
    pneumatic: 'Neumático',
    structural: 'Estructural',
    wheels: 'Rodados',
    others: 'Otros',
  };

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

/** Labor rate CLP/HH fallback por env var para compatibilidad operativa. */
function laborRatePerHhFromEnv(): number {
  const raw = process.env.WO_ANALYTICS_LABOR_RATE_PER_HH;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export type WorkOrderAnalyticsDashboard = {
  period: { from: string; to: string };
  periodHoursTotal: number;
  kpis: {
    fleetAvailabilityPct: number | null;
    mttrHours: number | null;
    mtbfHours: number | null;
    downtimeImpactHoursSi: number;
    correctiveOtCountForMttr: number;
    unplannedFailureIntervalsForMtbf: number;
  };
  availabilityByEquipment: Array<{
    equipmentId: string;
    internalId: string;
    plate: string | null;
    brand: string;
    model: string;
    availabilityPct: number | null;
    downtimeImpactHoursSi: number;
  }>;
  paretoSystems: Array<{ systemKey: string; label: string; otCount: number }>;
  programmedSplit: {
    programmed: number;
    notProgrammed: number;
    unknown: number;
  };
};

export type ProjectedServiceRow = {
  equipmentId: string;
  internalId: string;
  plate: string | null;
  brand: string;
  model: string;
  meterType: string;
  currentMeter: number;
  intervalUnits: number;
  intervalSource: PmIntervalSource;
  intervalSourceLabel: string;
  nextDueMeter: number;
  remainingUnits: number;
};

@Injectable()
export class WorkOrderAnalyticsService {
  private readonly logger = new Logger(WorkOrderAnalyticsService.name);

  constructor(private readonly prisma: PrismaService) {}

  private async resolveLaborRatePerHour(tenantId: string): Promise<number> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { laborRatePerHour: true },
    });

    const fromDb = tenant?.laborRatePerHour
      ? new Decimal(tenant.laborRatePerHour.toString()).toNumber()
      : 0;

    if (fromDb > 0) {
      return fromDb;
    }

    const fromEnv = laborRatePerHhFromEnv();
    if (fromEnv > 0) {
      return fromEnv;
    }

    this.logger.warn(
      `Tarifa HH en 0 para tenant ${tenantId}. Define tenant.laborRatePerHour en configuración de empresa o WO_ANALYTICS_LABOR_RATE_PER_HH como fallback.`,
    );
    return 0;
  }

  private equipmentAccessWhere(
    user: any,
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
    return {
      OR: [
        { contractId: { in: user.allowedContracts || [] } },
        {
          subcontract: { contractId: { in: user.allowedContracts || [] } },
        },
      ],
    };
  }

  private woWhere(
    user: any,
    activeContract?: string,
  ): Prisma.WorkOrderWhereInput {
    const tenantId = user.tenantId;
    const eqFilter = this.equipmentAccessWhere(user, activeContract);
    return eqFilter ? { tenantId, equipment: eqFilter } : { tenantId };
  }

  async getDashboard(
    user: any,
    fromRaw: string,
    toRaw: string,
    activeContract?: string,
  ): Promise<WorkOrderAnalyticsDashboard> {
    const from = new Date(fromRaw);
    const to = new Date(toRaw);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new BadRequestException('Rango de fechas inválido');
    }
    const rangeEnd = new Date(to);
    rangeEnd.setHours(23, 59, 59, 999);
    const periodHoursTotal = Math.max(0.001, hoursBetween(from, rangeEnd));

    const baseWo = this.woWhere(user, activeContract);

    const otsInPeriod = await this.prisma.workOrder.findMany({
      where: {
        ...baseWo,
        status: 'CLOSED',
        closedAt: { gte: from, lte: rangeEnd },
      },
      select: {
        id: true,
        equipmentId: true,
        category: true,
        maintenanceType: true,
        affectsAvailability: true,
        detentionStartedAt: true,
        detentionEndedAt: true,
        intervenedSystemsJson: true,
      },
    });

    let downtimeImpactHoursSi = 0;
    for (const ot of otsInPeriod) {
      if (
        ot.affectsAvailability !== 'SI' ||
        !ot.detentionStartedAt ||
        !ot.detentionEndedAt
      ) {
        continue;
      }
      downtimeImpactHoursSi += clipHours(
        ot.detentionStartedAt,
        ot.detentionEndedAt,
        from,
        rangeEnd,
      );
    }

    const fleetAvailabilityPct =
      periodHoursTotal > 0
        ? Math.max(
            0,
            Math.min(
              100,
              ((periodHoursTotal - downtimeImpactHoursSi) / periodHoursTotal) *
                100,
            ),
          )
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
    const mttrHours =
      correctiveDurations.length > 0
        ? correctiveDurations.reduce((a, b) => a + b, 0) /
          correctiveDurations.length
        : null;

    const unplanned = otsInPeriod.filter(
      (o) =>
        o.category === 'NO_PROGRAMADA_CORRECTIVA' ||
        o.category === 'NO_PROGRAMADA_REACTIVA',
    );
    const byEq = new Map<string, typeof unplanned>();
    for (const o of unplanned) {
      if (!o.detentionStartedAt) continue;
      const list = byEq.get(o.equipmentId) ?? [];
      list.push(o);
      byEq.set(o.equipmentId, list);
    }
    const intervals: number[] = [];
    for (const [, rows] of byEq) {
      const sorted = rows
        .filter((r) => r.detentionStartedAt)
        .sort(
          (a, b) =>
            a.detentionStartedAt!.getTime() - b.detentionStartedAt!.getTime(),
        );
      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1].detentionStartedAt!;
        const cur = sorted[i].detentionStartedAt!;
        intervals.push(Math.max(0, hoursBetween(prev, cur)));
      }
    }
    const mtbfHours =
      intervals.length > 0
        ? intervals.reduce((a, b) => a + b, 0) / intervals.length
        : null;

    const equipmentIds = await this.prisma.equipment.findMany({
      where: {
        tenantId: user.tenantId,
        ...(this.equipmentAccessWhere(user, activeContract) ?? {}),
      },
      select: {
        id: true,
        internalId: true,
        plate: true,
        brand: true,
        model: true,
      },
    });

    const availabilityByEquipment = equipmentIds.map((eq) => {
      let down = 0;
      for (const ot of otsInPeriod) {
        if (
          ot.equipmentId !== eq.id ||
          ot.affectsAvailability !== 'SI' ||
          !ot.detentionStartedAt ||
          !ot.detentionEndedAt
        ) {
          continue;
        }
        down += clipHours(
          ot.detentionStartedAt,
          ot.detentionEndedAt,
          from,
          rangeEnd,
        );
      }
      const pa =
        periodHoursTotal > 0
          ? Math.max(
              0,
              Math.min(
                100,
                ((periodHoursTotal - down) / periodHoursTotal) * 100,
              ),
            )
          : null;
      return {
        equipmentId: eq.id,
        internalId: eq.internalId,
        plate: eq.plate,
        brand: eq.brand,
        model: eq.model,
        availabilityPct: pa,
        downtimeImpactHoursSi: down,
      };
    });

    const paretoCounts = new Map<string, number>();
    for (const k of INTERVENTION_KEYS) {
      paretoCounts.set(k, 0);
    }
    for (const ot of otsInPeriod) {
      const j = ot.intervenedSystemsJson as Record<string, unknown> | null;
      if (!j || typeof j !== 'object') continue;
      for (const k of INTERVENTION_KEYS) {
        if (j[k] === true) {
          paretoCounts.set(k, (paretoCounts.get(k) ?? 0) + 1);
        }
      }
    }
    const paretoSystems = INTERVENTION_KEYS.map((key) => ({
      systemKey: key,
      label: INTERVENTION_LABELS[key],
      otCount: paretoCounts.get(key) ?? 0,
    })).sort((a, b) => b.otCount - a.otCount);

    let programmed = 0;
    let notProgrammed = 0;
    let unknown = 0;
    for (const ot of otsInPeriod) {
      if (ot.category === 'PROGRAMADA') programmed++;
      else if (
        ot.category === 'NO_PROGRAMADA_CORRECTIVA' ||
        ot.category === 'NO_PROGRAMADA_REACTIVA'
      ) {
        notProgrammed++;
      } else unknown++;
    }

    return {
      period: { from: from.toISOString(), to: rangeEnd.toISOString() },
      periodHoursTotal,
      kpis: {
        fleetAvailabilityPct,
        mttrHours,
        mtbfHours,
        downtimeImpactHoursSi,
        correctiveOtCountForMttr: correctiveDurations.length,
        unplannedFailureIntervalsForMtbf: intervals.length,
      },
      availabilityByEquipment,
      paretoSystems,
      programmedSplit: { programmed, notProgrammed, unknown },
    };
  }

  async getProjectedServices(
    user: any,
    activeContract?: string,
    limit = 200,
  ): Promise<ProjectedServiceRow[]> {
    const eqFilter = this.equipmentAccessWhere(user, activeContract);
    const rows = await this.prisma.equipment.findMany({
      where: {
        tenantId: user.tenantId,
        ...(eqFilter ?? {}),
      },
      take: Math.min(500, Math.max(1, limit)),
      orderBy: { internalId: 'asc' },
      select: {
        id: true,
        internalId: true,
        plate: true,
        brand: true,
        model: true,
        type: true,
        meterType: true,
        initialMeter: true,
        currentMeter: true,
        maintenanceFrequency: true,
        pmIntervalOverride: true,
        lastMaintenanceMeter: true,
      },
    });

    const out: ProjectedServiceRow[] = [];
    for (const r of rows) {
      const pmIn: EquipmentPmInput = {
        type: r.type,
        model: r.model,
        meterType: r.meterType as EquipmentPmInput['meterType'],
        initialMeter: r.initialMeter,
        currentMeter: r.currentMeter,
        maintenanceFrequency: r.maintenanceFrequency,
        pmIntervalOverride: r.pmIntervalOverride,
        lastMaintenanceMeter: r.lastMaintenanceMeter,
      };
      const proj = computePmProjection(pmIn);
      const src = proj.source;
      out.push({
        equipmentId: r.id,
        internalId: r.internalId,
        plate: r.plate,
        brand: r.brand,
        model: r.model,
        meterType: r.meterType,
        currentMeter: r.currentMeter,
        intervalUnits: proj.interval,
        intervalSource: src,
        intervalSourceLabel: pmIntervalSourceLabel(src),
        nextDueMeter: proj.nextDueMeter,
        remainingUnits: proj.remainingUnits,
      });
    }
    return out;
  }

  async getMonthlyManagementPdf(
    user: any,
    year: number,
    month: number,
    activeContract?: string,
  ): Promise<{ buffer: Buffer; filename: string }> {
    if (
      !Number.isFinite(year) ||
      year < 1970 ||
      year > 2100 ||
      !Number.isFinite(month) ||
      month < 1 ||
      month > 12
    ) {
      throw new BadRequestException('Mes o año inválidos');
    }

    let contractLabel = 'Todos los contratos';
    if (activeContract && activeContract !== 'ALL') {
      const c = await this.prisma.contract.findFirst({
        where: { id: activeContract, tenantId: user.tenantId },
        select: { code: true, name: true },
      });
      contractLabel = c ? `${c.code} — ${c.name}` : activeContract;
    }

    const from = new Date(year, month - 1, 1, 0, 0, 0, 0);
    const to = new Date(year, month, 0, 23, 59, 59, 999);

    const dashboard = await this.getDashboard(
      user,
      from.toISOString(),
      to.toISOString(),
      activeContract,
    );

    const baseWo = this.woWhere(user, activeContract);
    const costWhere: Prisma.AssetCostRecordWhereInput = {
      tenantId: user.tenantId,
      type: 'WORK_ORDER',
      recordedAt: { gte: from, lte: to },
    };
    if (baseWo.equipment) {
      costWhere.equipment = baseWo.equipment;
    }
    const costs = await this.prisma.assetCostRecord.aggregate({
      where: costWhere,
      _sum: { amount: true },
    });

    const hhAgg = await this.prisma.workOrder.aggregate({
      where: {
        ...baseWo,
        status: 'CLOSED',
        closedAt: { gte: from, lte: to },
        metricHh: { not: null },
      },
      _sum: { metricHh: true },
    });

    const hhHours = hhAgg._sum.metricHh
      ? new Decimal(hhAgg._sum.metricHh.toString()).toNumber()
      : 0;
    const laborRate = await this.resolveLaborRatePerHour(user.tenantId);
    const laborCostEstimate = hhHours * laborRate;

    const partsFluidCost = costs._sum.amount
      ? new Decimal(costs._sum.amount.toString()).toNumber()
      : 0;

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: user.tenantId },
      select: { name: true },
    });

    const availabilityReferenceLines = [...dashboard.availabilityByEquipment]
      .sort((a, b) => (a.availabilityPct ?? 100) - (b.availabilityPct ?? 100))
      .slice(0, 15)
      .map((eq) => ({
        label: equipmentDisplayLabel(eq),
        availabilityPct:
          eq.availabilityPct != null
            ? `${eq.availabilityPct.toFixed(1)} %`
            : '—',
      }));

    const buffer = await generateWorkOrderManagementMonthlyPdfBuffer({
      tenantName: tenant?.name ?? 'Tenant',
      year,
      month,
      contractLabel,
      dashboard: {
        kpis: dashboard.kpis,
        paretoSystems: dashboard.paretoSystems.map((p) => ({
          label: p.label,
          otCount: p.otCount,
        })),
        programmedSplit: dashboard.programmedSplit,
      },
      availabilityReferenceLines,
      totalAssetCostWo: partsFluidCost,
      totalLaborHours: hhHours,
      laborRatePerHour: laborRate,
      laborCostEstimate,
      totalMaintenanceEstimate: partsFluidCost + laborCostEstimate,
    });

    const mm = String(month).padStart(2, '0');
    const filename = `Resumen_Gestion_Mantenimiento_${year}-${mm}.pdf`;
    return { buffer, filename };
  }
}
