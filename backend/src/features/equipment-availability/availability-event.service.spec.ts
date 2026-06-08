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
