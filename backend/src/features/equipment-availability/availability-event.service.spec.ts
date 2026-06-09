import { Test, TestingModule } from '@nestjs/testing';
import { readFileSync } from 'fs';
import { join } from 'path';
import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import {
  AvailabilityEventSource,
  OperationalStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AvailabilityEventService } from './availability-event.service';

const tenantId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const equipmentId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const availabilityId = '11111111-1111-1111-1111-111111111111';
const userId = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

describe('AvailabilityEventService — register', () => {
  let service: AvailabilityEventService;
  let prisma: DeepMockProxy<PrismaService>;
  let tx: DeepMockProxy<Prisma.TransactionClient>;

  beforeEach(async () => {
    prisma = mockDeep<PrismaService>();
    tx = mockDeep<Prisma.TransactionClient>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AvailabilityEventService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(AvailabilityEventService);
  });

  it('crea múltiples eventos asociados al mismo snapshot cuando cambia el estado en el mismo turno', async () => {
    tx.availabilityEvent.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        eventAt: new Date('2026-06-08T08:00:00.000Z'),
        status: OperationalStatus.OPERATIONAL,
      } as never);
    tx.availabilityEvent.create.mockImplementation(async (args: any) => ({
      id: `event-${tx.availabilityEvent.create.mock.calls.length}`,
      ...args.data,
    }));

    await service.register(tx, {
      tenantId,
      availabilityId,
      equipmentId,
      reportedById: userId,
      status: OperationalStatus.OPERATIONAL,
      previousStatus: null,
      eventAt: new Date('2026-06-08T08:00:00.000Z'),
      source: AvailabilityEventSource.MANUAL,
    });
    await service.register(tx, {
      tenantId,
      availabilityId,
      equipmentId,
      reportedById: userId,
      status: OperationalStatus.DOWN_FAILURE,
      previousStatus: OperationalStatus.OPERATIONAL,
      eventAt: new Date('2026-06-08T10:30:00.000Z'),
      source: AvailabilityEventSource.MANUAL,
    });

    expect(tx.availabilityEvent.create).toHaveBeenCalledTimes(2);
    expect(tx.availabilityEvent.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          availabilityId,
          status: OperationalStatus.DOWN_FAILURE,
          previousStatus: OperationalStatus.OPERATIONAL,
          elapsedMinutes: 150,
        }),
      }),
    );
  });

  describe('Validaciones por Source', () => {
    it('debe rechazar eventos con source OT porque no están soportados', async () => {
      await expect(
        service.register(tx as any, {
          tenantId: 't1',
          equipmentId: 'e1',
          status: OperationalStatus.DOWN_PLANNED,
          eventAt: new Date(),
          source: AvailabilityEventSource.OT,
        }),
      ).rejects.toThrow();
    });

    it('debe rechazar evento FAULT_REPORT si omite faultReportId', async () => {
      await expect(
        service.register(tx as any, {
          tenantId: 't1',
          equipmentId: 'e1',
          status: OperationalStatus.DOWN_FAILURE,
          eventAt: new Date(),
          source: AvailabilityEventSource.FAULT_REPORT,
        }),
      ).rejects.toMatchObject({ message: 'faultReportId es requerido para eventos de falla.' });
    });

    it('debe rechazar evento FAULT_REPORT si incluye availabilityId', async () => {
      await expect(
        service.register(tx as any, {
          tenantId: 't1',
          equipmentId: 'e1',
          status: OperationalStatus.DOWN_FAILURE,
          eventAt: new Date(),
          source: AvailabilityEventSource.FAULT_REPORT,
          faultReportId: 'f1',
          availabilityId: 'a1',
        }),
      ).rejects.toMatchObject({ message: 'availabilityId no debe informarse para eventos de falla.' });
    });

    it('debe rechazar evento FAULT_REPORT si el FaultReport no pertenece al tenant/equipo', async () => {
      tx.faultReport.findFirst.mockResolvedValueOnce({ tenantId: 't2', equipmentId: 'e1' } as any);
      await expect(
        service.register(tx as any, {
          tenantId: 't1',
          equipmentId: 'e1',
          status: OperationalStatus.DOWN_FAILURE,
          eventAt: new Date(),
          source: AvailabilityEventSource.FAULT_REPORT,
          faultReportId: 'f1',
        }),
      ).rejects.toMatchObject({ message: 'El FaultReport no existe o no corresponde al mismo tenant/equipo.' });
    });

    it('debe rechazar evento MANUAL si omite availabilityId', async () => {
      await expect(
        service.register(tx as any, {
          tenantId: 't1',
          equipmentId: 'e1',
          status: OperationalStatus.DOWN_FAILURE,
          eventAt: new Date(),
          source: AvailabilityEventSource.MANUAL,
        }),
      ).rejects.toMatchObject({ message: 'availabilityId es requerido para el origen MANUAL.' });
    });

    it('debe rechazar evento MANUAL si incluye faultReportId', async () => {
      await expect(
        service.register(tx as any, {
          tenantId: 't1',
          equipmentId: 'e1',
          status: OperationalStatus.DOWN_FAILURE,
          eventAt: new Date(),
          source: AvailabilityEventSource.MANUAL,
          availabilityId: 'a1',
          faultReportId: 'f1',
        }),
      ).rejects.toMatchObject({ message: 'faultReportId no debe informarse para el origen MANUAL.' });
    });

    it('debe registrar exitosamente un evento de falla con su faultReportId y sin availabilityId', async () => {
      tx.faultReport.findFirst.mockResolvedValueOnce({ tenantId, equipmentId } as any);
      tx.availabilityEvent.findFirst.mockResolvedValueOnce(null);
      tx.availabilityEvent.create.mockResolvedValueOnce({ id: 'event-1' } as never);

      await service.register(tx as any, {
        tenantId,
        equipmentId,
        status: OperationalStatus.DOWN_PLANNED,
        eventAt: new Date(),
        source: AvailabilityEventSource.FAULT_REPORT,
        faultReportId: 'f1',
      });

      expect(tx.availabilityEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            faultReportId: 'f1',
            availabilityId: null,
          }),
        }),
      );
    });

    it('debe delegar a Prisma la restricción única (P2002) si se intenta reusar un faultReportId', async () => {
      tx.faultReport.findFirst.mockResolvedValueOnce({ tenantId, equipmentId } as any);
      tx.availabilityEvent.create = jest.fn().mockRejectedValue({
        code: 'P2002',
        clientVersion: '7.5.0',
      });

      await expect(
        service.register(tx as any, {
          tenantId,
          equipmentId,
          status: OperationalStatus.DOWN_PLANNED,
          eventAt: new Date(),
          source: AvailabilityEventSource.FAULT_REPORT,
          faultReportId: 'f1', // Reuso intencionado
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
    });
  });

  it('recupera el historial de eventos en orden cronológico ASC', async () => {
    const events = [
      { id: 'event-1', eventAt: new Date('2026-06-08T08:00:00.000Z') },
      { id: 'event-2', eventAt: new Date('2026-06-08T10:30:00.000Z') },
    ];
    prisma.availabilityEvent.findMany.mockResolvedValue(events as never);

    const result = await service.findTimeline(tenantId, equipmentId, {
      dateFrom: new Date('2026-06-08T00:00:00.000Z'),
      dateTo: new Date('2026-06-08T23:59:59.999Z'),
    });

    expect(result).toBe(events);
    expect(prisma.availabilityEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId, equipmentId }),
        orderBy: { eventAt: 'asc' },
      }),
    );
  });
});

describe('AvailabilityEventService — legacy backfill migration', () => {
  it('evita duplicar eventos LEGACY_SNAPSHOT y conserva un evento por snapshot existente', () => {
    const migration = readFileSync(
      join(
        __dirname,
        '../../../prisma/migrations/20260608_add_availability_events/migration.sql',
      ),
      'utf8',
    );

    expect(migration).toContain(
      'CREATE UNIQUE INDEX "availability_events_legacy_snapshot_unique"',
    );
    expect(migration).toContain('WHERE "source" = \'LEGACY_SNAPSHOT\'');
    expect(migration).toContain('INSERT INTO "availability_events"');
    expect(migration).toContain('FROM "equipment_availabilities" ea');
    expect(migration).toContain('WHERE NOT EXISTS');
    expect(migration).not.toContain('UPDATE "equipment_availabilities"');
  });
});
