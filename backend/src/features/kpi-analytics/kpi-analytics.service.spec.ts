import { BadRequestException } from '@nestjs/common';
import { OperationalStatus } from '@prisma/client';
import { mockDeep, mockReset } from 'jest-mock-extended';
import { PrismaService } from '../../prisma/prisma.service';
import { KpiAnalyticsService } from './kpi-analytics.service';

const adminUser = {
  id: 'usr-1',
  tenantId: 'tenant-1',
  role: 'ADMIN' as const,
  allowedContracts: ['ALL'],
};

describe('KpiAnalyticsService', () => {
  const prisma = mockDeep<PrismaService>();
  let service: KpiAnalyticsService;

  beforeEach(() => {
    mockReset(prisma);
    service = new KpiAnalyticsService(prisma);
  });

  it('rechaza rango de fechas inválido', async () => {
    await expect(
      service.getKpiDashboard(adminUser, 'invalid', '2026-06-04'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('calcula PA%, MTTR y MTBF con agregaciones Prisma', async () => {
    prisma.equipmentAvailability.groupBy.mockResolvedValue([
      {
        status: OperationalStatus.OPERATIONAL,
        _count: { _all: 8 },
      },
      {
        status: OperationalStatus.DOWN_FAILURE,
        _count: { _all: 2 },
      },
    ] as any);

    prisma.workOrder.findMany.mockResolvedValue([
      {
        maintenanceType: 'CORRECTIVO',
        detentionStartedAt: new Date('2026-06-01T08:00:00Z'),
        detentionEndedAt: new Date('2026-06-01T12:00:00Z'),
      },
      {
        maintenanceType: 'CORRECTIVO',
        detentionStartedAt: new Date('2026-06-02T08:00:00Z'),
        detentionEndedAt: new Date('2026-06-02T10:00:00Z'),
      },
    ] as any);

    prisma.faultReport.findMany.mockResolvedValue([
      {
        equipmentId: 'eq-1',
        eventDate: new Date('2026-06-01T00:00:00Z'),
      },
      {
        equipmentId: 'eq-1',
        eventDate: new Date('2026-06-03T00:00:00Z'),
      },
    ] as any);

    prisma.lubeReport.findMany.mockResolvedValue([
      {
        dispatchDate: new Date('2026-06-05T10:00:00Z'),
        lines: [
          {
            quantity: 50,
            item: { unitOfMeasure: { abbreviation: 'LT' } },
          },
        ],
      },
    ] as any);

    prisma.equipmentMeterLog.findMany.mockResolvedValue([
      {
        date: new Date('2026-06-05T10:00:00Z'),
        oldValue: 1000,
        newValue: 1100,
      },
    ] as any);

    const result = await service.getKpiDashboard(
      adminUser,
      '2026-06-01',
      '2026-06-30',
    );

    expect(result.kpis.physicalAvailabilityPct).toBe(80);
    expect(result.physicalAvailability.reportedShifts).toBe(10);
    expect(result.physicalAvailability.operationalShifts).toBe(8);
    expect(result.kpis.mttrHours).toBe(3);
    expect(result.mttr.correctiveOtCount).toBe(2);
    expect(result.kpis.mtbfHours).toBe(48);
    expect(result.mtbf.criticalFaultCount).toBe(2);
    expect(result.lubeTrendMonthly.length).toBeGreaterThan(0);
    expect(result.lubeTrendMonthly[0].totalLiters).toBe(50);
    expect(result.lubeTrendMonthly[0].machineHours).toBe(100);
  });

  it('devuelve respuesta cacheada en la segunda llamada idéntica', async () => {
    prisma.equipmentAvailability.groupBy.mockResolvedValue([
      { status: OperationalStatus.OPERATIONAL, _count: { _all: 1 } },
    ] as any);
    prisma.workOrder.findMany.mockResolvedValue([]);
    prisma.faultReport.findMany.mockResolvedValue([]);
    prisma.lubeReport.findMany.mockResolvedValue([]);
    prisma.equipmentMeterLog.findMany.mockResolvedValue([]);

    const first = await service.getKpiDashboard(
      adminUser,
      '2026-06-01',
      '2026-06-30',
    );
    const second = await service.getKpiDashboard(
      adminUser,
      '2026-06-01',
      '2026-06-30',
    );

    expect(first.meta.cached).toBe(false);
    expect(second.meta.cached).toBe(true);
    expect(prisma.equipmentAvailability.groupBy).toHaveBeenCalledTimes(1);
  });
});
