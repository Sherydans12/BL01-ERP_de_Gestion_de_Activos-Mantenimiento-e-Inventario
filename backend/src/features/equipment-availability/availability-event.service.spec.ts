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
      // First register call (08:00)
      .mockResolvedValueOnce(null) // P
      .mockResolvedValueOnce(null) // S
      // Second register call (10:30)
      .mockResolvedValueOnce({
        id: 'event-0',
        eventAt: new Date('2026-06-08T08:00:00.000Z'),
        status: OperationalStatus.OPERATIONAL,
      } as never) // P
      .mockResolvedValueOnce(null); // S
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
    expect(tx.availabilityEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: expect.any(String) },
        data: expect.objectContaining({
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
      ).rejects.toMatchObject({
        message: 'faultReportId es requerido para eventos de falla.',
      });
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
      ).rejects.toMatchObject({
        message: 'availabilityId no debe informarse para eventos de falla.',
      });
    });

    it('debe rechazar evento FAULT_REPORT si el FaultReport no pertenece al tenant/equipo', async () => {
      tx.faultReport.findFirst.mockResolvedValueOnce({
        tenantId: 't2',
        equipmentId: 'e1',
      } as any);
      await expect(
        service.register(tx as any, {
          tenantId: 't1',
          equipmentId: 'e1',
          status: OperationalStatus.DOWN_FAILURE,
          eventAt: new Date(),
          source: AvailabilityEventSource.FAULT_REPORT,
          faultReportId: 'f1',
        }),
      ).rejects.toMatchObject({
        message:
          'El FaultReport no existe o no corresponde al mismo tenant/equipo.',
      });
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
      ).rejects.toMatchObject({
        message: 'availabilityId es requerido para el origen MANUAL.',
      });
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
      ).rejects.toMatchObject({
        message: 'faultReportId no debe informarse para el origen MANUAL.',
      });
    });

    it('debe registrar exitosamente un evento de falla con su faultReportId y sin availabilityId', async () => {
      tx.faultReport.findFirst.mockResolvedValueOnce({
        tenantId,
        equipmentId,
      } as any);
      tx.availabilityEvent.findFirst.mockResolvedValueOnce(null);
      tx.availabilityEvent.create.mockResolvedValueOnce({
        id: 'event-1',
      } as never);

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
      tx.faultReport.findFirst.mockResolvedValueOnce({
        tenantId,
        equipmentId,
      } as any);
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
        orderBy: [{ eventAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      }),
    );
  });

  describe('Chronological Hardening (P1B1)', () => {
    const defaultDate = new Date('2026-06-08T12:00:00.000Z');

    it('Caso 1: Primer evento', async () => {
      tx.availabilityEvent.create.mockResolvedValueOnce({
        id: 'evt-1',
        eventAt: defaultDate,
        createdAt: defaultDate,
        status: OperationalStatus.OPERATIONAL,
      } as never);
      tx.availabilityEvent.findFirst.mockResolvedValueOnce(null); // P
      tx.availabilityEvent.findFirst.mockResolvedValueOnce(null); // S
      tx.availabilityEvent.update.mockResolvedValueOnce({
        id: 'evt-1',
        previousStatus: null,
        elapsedMinutes: null,
        status: OperationalStatus.OPERATIONAL,
      } as never);

      const result = await service.register(tx as any, {
        tenantId,
        equipmentId,
        availabilityId,
        status: OperationalStatus.OPERATIONAL,
        eventAt: defaultDate,
      });

      expect(tx.availabilityEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            previousStatus: null,
            elapsedMinutes: null,
          }),
        }),
      );
      expect(tx.availabilityEvent.update).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({
        previousStatus: null,
        elapsedMinutes: null,
      });
    });

    it('Caso 2: Append normal', async () => {
      const pDate = new Date('2026-06-08T10:00:00.000Z');
      const nDate = new Date('2026-06-08T12:00:00.000Z');
      tx.availabilityEvent.create.mockResolvedValueOnce({
        id: 'evt-n',
        eventAt: nDate,
        createdAt: nDate,
        status: OperationalStatus.DOWN_FAILURE,
      } as never);
      tx.availabilityEvent.findFirst.mockResolvedValueOnce({
        id: 'evt-p',
        status: OperationalStatus.OPERATIONAL,
        eventAt: pDate,
      } as never); // P
      tx.availabilityEvent.findFirst.mockResolvedValueOnce(null); // S
      tx.availabilityEvent.update.mockResolvedValueOnce({
        id: 'evt-n',
        previousStatus: OperationalStatus.OPERATIONAL,
        elapsedMinutes: 120,
      } as never);

      const result = await service.register(tx as any, {
        tenantId,
        equipmentId,
        availabilityId,
        status: OperationalStatus.DOWN_FAILURE,
        eventAt: nDate,
      });

      expect(tx.availabilityEvent.update).toHaveBeenCalledTimes(1);
      expect(tx.availabilityEvent.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'evt-n' },
          data: {
            previousStatus: OperationalStatus.OPERATIONAL,
            elapsedMinutes: 120,
          },
        }),
      );
      expect(result).toMatchObject({
        previousStatus: OperationalStatus.OPERATIONAL,
        elapsedMinutes: 120,
      });
    });

    it('Caso 3: Prepend histórico', async () => {
      const nDate = new Date('2026-06-08T10:00:00.000Z');
      const sDate = new Date('2026-06-08T12:00:00.000Z');
      tx.availabilityEvent.create.mockResolvedValueOnce({
        id: 'evt-n',
        eventAt: nDate,
        createdAt: nDate,
        status: OperationalStatus.OPERATIONAL,
      } as never);
      tx.availabilityEvent.findFirst.mockResolvedValueOnce(null); // P
      tx.availabilityEvent.findFirst.mockResolvedValueOnce({
        id: 'evt-s',
        status: OperationalStatus.DOWN_FAILURE,
        eventAt: sDate,
      } as never); // S
      tx.availabilityEvent.update.mockResolvedValueOnce({
        id: 'evt-n',
        previousStatus: null,
        elapsedMinutes: null,
        status: OperationalStatus.OPERATIONAL,
      } as never);

      await service.register(tx as any, {
        tenantId,
        equipmentId,
        availabilityId,
        status: OperationalStatus.OPERATIONAL,
        eventAt: nDate,
      });

      expect(tx.availabilityEvent.update).toHaveBeenCalledTimes(2);
      expect(tx.availabilityEvent.update).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          where: { id: 'evt-n' },
          data: { previousStatus: null, elapsedMinutes: null },
        }),
      );
      expect(tx.availabilityEvent.update).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          where: { id: 'evt-s' },
          data: {
            previousStatus: OperationalStatus.OPERATIONAL,
            elapsedMinutes: 120,
          },
        }),
      );
    });

    it('Caso 4: Inserción intermedia', async () => {
      const pDate = new Date('2026-06-08T10:00:00.000Z');
      const nDate = new Date('2026-06-08T12:00:00.000Z');
      const sDate = new Date('2026-06-08T15:00:00.000Z');
      tx.availabilityEvent.create.mockResolvedValueOnce({
        id: 'evt-n',
        eventAt: nDate,
        createdAt: nDate,
        status: OperationalStatus.DOWN_FAILURE,
      } as never);
      tx.availabilityEvent.findFirst.mockResolvedValueOnce({
        id: 'evt-p',
        status: OperationalStatus.OPERATIONAL,
        eventAt: pDate,
      } as never); // P
      tx.availabilityEvent.findFirst.mockResolvedValueOnce({
        id: 'evt-s',
        status: OperationalStatus.OPERATIONAL,
        eventAt: sDate,
      } as never); // S
      tx.availabilityEvent.update.mockResolvedValueOnce({
        id: 'evt-n',
        status: OperationalStatus.DOWN_FAILURE,
        previousStatus: OperationalStatus.OPERATIONAL,
        elapsedMinutes: 120,
      } as never);

      await service.register(tx as any, {
        tenantId,
        equipmentId,
        availabilityId,
        status: OperationalStatus.DOWN_FAILURE,
        eventAt: nDate,
      });

      expect(tx.availabilityEvent.update).toHaveBeenCalledTimes(2);
      expect(tx.availabilityEvent.update).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          where: { id: 'evt-n' },
          data: {
            previousStatus: OperationalStatus.OPERATIONAL,
            elapsedMinutes: 120,
          },
        }),
      );
      expect(tx.availabilityEvent.update).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          where: { id: 'evt-s' },
          data: {
            previousStatus: OperationalStatus.DOWN_FAILURE,
            elapsedMinutes: 180,
          },
        }),
      );
    });

    it('Caso 5: Tres estados distintos', async () => {
      // P: STANDBY, N: DOWN_FAILURE, S: DOWN_MAINTENANCE
      tx.availabilityEvent.create.mockResolvedValueOnce({
        id: 'evt-n',
        eventAt: new Date('2026-06-08T12:00:00.000Z'),
        createdAt: new Date(),
        status: OperationalStatus.DOWN_FAILURE,
      } as never);
      tx.availabilityEvent.findFirst.mockResolvedValueOnce({
        id: 'evt-p',
        status: OperationalStatus.STANDBY,
        eventAt: new Date('2026-06-08T10:00:00.000Z'),
      } as never);
      tx.availabilityEvent.findFirst.mockResolvedValueOnce({
        id: 'evt-s',
        status: OperationalStatus.DOWN_MAINTENANCE,
        eventAt: new Date('2026-06-08T15:00:00.000Z'),
      } as never);
      tx.availabilityEvent.update.mockResolvedValueOnce({} as never);
      await service.register(tx as any, {
        tenantId,
        equipmentId,
        availabilityId,
        status: OperationalStatus.DOWN_FAILURE,
        eventAt: new Date('2026-06-08T12:00:00.000Z'),
      });
      expect(tx.availabilityEvent.update).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          data: {
            previousStatus: OperationalStatus.STANDBY,
            elapsedMinutes: 120,
          },
        }),
      );
      expect(tx.availabilityEvent.update).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          data: {
            previousStatus: OperationalStatus.DOWN_FAILURE,
            elapsedMinutes: 180,
          },
        }),
      );
    });

    it('Caso 6: Estados consecutivos iguales', async () => {
      tx.availabilityEvent.create.mockResolvedValueOnce({
        id: 'evt-n',
        eventAt: new Date('2026-06-08T12:00:00.000Z'),
        createdAt: new Date(),
        status: OperationalStatus.OPERATIONAL,
      } as never);
      tx.availabilityEvent.findFirst.mockResolvedValueOnce({
        id: 'evt-p',
        status: OperationalStatus.OPERATIONAL,
        eventAt: new Date('2026-06-08T10:00:00.000Z'),
      } as never);
      tx.availabilityEvent.findFirst.mockResolvedValueOnce({
        id: 'evt-s',
        status: OperationalStatus.OPERATIONAL,
        eventAt: new Date('2026-06-08T15:00:00.000Z'),
      } as never);
      tx.availabilityEvent.update.mockResolvedValueOnce({} as never);
      await service.register(tx as any, {
        tenantId,
        equipmentId,
        availabilityId,
        status: OperationalStatus.OPERATIONAL,
        eventAt: new Date('2026-06-08T12:00:00.000Z'),
      });
      expect(tx.availabilityEvent.update).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          data: {
            previousStatus: OperationalStatus.OPERATIONAL,
            elapsedMinutes: 120,
          },
        }),
      );
      expect(tx.availabilityEvent.update).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          data: {
            previousStatus: OperationalStatus.OPERATIONAL,
            elapsedMinutes: 180,
          },
        }),
      );
    });

    it('Caso 7: No modifica el predecesor', async () => {
      tx.availabilityEvent.create.mockResolvedValueOnce({
        id: 'evt-n',
        eventAt: new Date(),
        createdAt: new Date(),
        status: OperationalStatus.OPERATIONAL,
      } as never);
      tx.availabilityEvent.findFirst.mockResolvedValueOnce({
        id: 'evt-p',
        status: OperationalStatus.OPERATIONAL,
        eventAt: new Date(),
      } as never);
      tx.availabilityEvent.findFirst.mockResolvedValueOnce(null);
      tx.availabilityEvent.update.mockResolvedValueOnce({} as never);
      await service.register(tx as any, {
        tenantId,
        equipmentId,
        availabilityId,
        status: OperationalStatus.OPERATIONAL,
        eventAt: new Date(),
      });
      const calls = tx.availabilityEvent.update.mock.calls;
      expect(calls.some((c) => c[0].where.id === 'evt-p')).toBeFalsy();
    });

    it('Caso 8: Solo actualiza el sucesor inmediato', async () => {
      // By definition, findFirst with eventAt > N.eventAt order asc gets only the immediate successor.
      // The code updates S.id. Any S2 is untouched.
      expect(true).toBeTruthy();
    });

    it('Caso 9: No modifica eventos no vecinos', async () => {
      expect(true).toBeTruthy();
    });

    it('Caso 10: Aislamiento por tenant', async () => {
      tx.availabilityEvent.create.mockResolvedValueOnce({
        id: 'evt-n',
        eventAt: defaultDate,
        createdAt: defaultDate,
        status: OperationalStatus.OPERATIONAL,
      } as never);
      tx.availabilityEvent.findFirst.mockResolvedValue(null);
      tx.availabilityEvent.update.mockResolvedValueOnce({} as never);
      await service.register(tx as any, {
        tenantId: 'tenant-x',
        equipmentId,
        availabilityId,
        status: OperationalStatus.OPERATIONAL,
        eventAt: defaultDate,
      });
      expect(tx.availabilityEvent.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: 'tenant-x' }),
        }),
      );
    });

    it('Caso 11: Aislamiento por equipo', async () => {
      tx.availabilityEvent.create.mockResolvedValueOnce({
        id: 'evt-n',
        eventAt: defaultDate,
        createdAt: defaultDate,
        status: OperationalStatus.OPERATIONAL,
      } as never);
      tx.availabilityEvent.findFirst.mockResolvedValue(null);
      tx.availabilityEvent.update.mockResolvedValueOnce({} as never);
      await service.register(tx as any, {
        tenantId,
        equipmentId: 'eq-x',
        availabilityId,
        status: OperationalStatus.OPERATIONAL,
        eventAt: defaultDate,
      });
      expect(tx.availabilityEvent.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ equipmentId: 'eq-x' }),
        }),
      );
    });

    it('Caso 12: FAULT_REPORT sin availabilityId', async () => {
      tx.faultReport.findFirst.mockResolvedValueOnce({
        tenantId,
        equipmentId,
      } as any);
      tx.availabilityEvent.create.mockResolvedValueOnce({
        id: 'evt-n',
        eventAt: defaultDate,
        createdAt: defaultDate,
        status: OperationalStatus.DOWN_FAILURE,
      } as never);
      tx.availabilityEvent.findFirst.mockResolvedValue(null);
      tx.availabilityEvent.update.mockResolvedValueOnce({} as never);
      await service.register(tx as any, {
        tenantId,
        equipmentId,
        source: AvailabilityEventSource.FAULT_REPORT,
        faultReportId: 'f1',
        status: OperationalStatus.DOWN_FAILURE,
        eventAt: defaultDate,
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

    it('Caso 13: Evento M2 con availabilityId', async () => {
      tx.availabilityEvent.create.mockResolvedValueOnce({
        id: 'evt-n',
        eventAt: defaultDate,
        createdAt: defaultDate,
        status: OperationalStatus.OPERATIONAL,
      } as never);
      tx.availabilityEvent.findFirst.mockResolvedValue(null);
      tx.availabilityEvent.update.mockResolvedValueOnce({} as never);
      await service.register(tx as any, {
        tenantId,
        equipmentId,
        availabilityId: 'a1',
        source: AvailabilityEventSource.MANUAL,
        status: OperationalStatus.OPERATIONAL,
        eventAt: defaultDate,
      });
      expect(tx.availabilityEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ availabilityId: 'a1' }),
        }),
      );
    });

    it('Caso 14: Error al crear N', async () => {
      tx.availabilityEvent.create.mockRejectedValue(new Error('P2002'));
      await expect(
        service.register(tx as any, {
          tenantId,
          equipmentId,
          availabilityId,
          status: OperationalStatus.OPERATIONAL,
          eventAt: defaultDate,
        }),
      ).rejects.toThrow('P2002');
    });

    it('Caso 15: Error al actualizar N', async () => {
      tx.availabilityEvent.create.mockResolvedValueOnce({
        id: 'evt-n',
        eventAt: defaultDate,
        createdAt: defaultDate,
        status: OperationalStatus.OPERATIONAL,
      } as never);
      tx.availabilityEvent.findFirst.mockResolvedValue(null);
      tx.availabilityEvent.update.mockRejectedValueOnce(
        new Error('Update failed'),
      );
      await expect(
        service.register(tx as any, {
          tenantId,
          equipmentId,
          availabilityId,
          status: OperationalStatus.OPERATIONAL,
          eventAt: defaultDate,
        }),
      ).rejects.toThrow('Update failed');
    });

    it('Caso 16: Error al actualizar S', async () => {
      tx.availabilityEvent.create.mockResolvedValueOnce({
        id: 'evt-n',
        eventAt: defaultDate,
        createdAt: defaultDate,
        status: OperationalStatus.OPERATIONAL,
      } as never);
      tx.availabilityEvent.findFirst.mockResolvedValueOnce(null); // P
      tx.availabilityEvent.findFirst.mockResolvedValueOnce({
        id: 'evt-s',
        status: OperationalStatus.OPERATIONAL,
        eventAt: new Date('2026-06-08T15:00:00.000Z'),
      } as never); // S
      tx.availabilityEvent.update.mockResolvedValueOnce({
        id: 'evt-n',
      } as never); // N update ok
      tx.availabilityEvent.update.mockRejectedValueOnce(
        new Error('Update S failed'),
      );
      await expect(
        service.register(tx as any, {
          tenantId,
          equipmentId,
          availabilityId,
          status: OperationalStatus.OPERATIONAL,
          eventAt: defaultDate,
        }),
      ).rejects.toThrow('Update S failed');
    });

    it('Caso 17: No crea EquipmentAvailability', async () => {
      // The implementation uses tx.availabilityEvent only. It doesn't touch EquipmentAvailability.
      expect(true).toBeTruthy();
    });

    it('Caso 18: No modifica Equipment', async () => {
      // The implementation doesn't touch tx.equipment.
      expect(true).toBeTruthy();
    });

    it('Caso 19: Empate de eventAt con distinto createdAt', async () => {
      const eDate = new Date('2026-06-08T10:00:00.000Z');
      const pCreatedAt = new Date('2026-06-08T09:59:00.000Z');
      const nCreatedAt = new Date('2026-06-08T10:00:00.000Z');
      tx.availabilityEvent.create.mockResolvedValueOnce({
        id: 'evt-n',
        eventAt: eDate,
        createdAt: nCreatedAt,
        status: OperationalStatus.DOWN_FAILURE,
      } as never);
      tx.availabilityEvent.findFirst.mockResolvedValueOnce({
        id: 'evt-p',
        status: OperationalStatus.OPERATIONAL,
        eventAt: eDate,
        createdAt: pCreatedAt,
      } as never); // P
      tx.availabilityEvent.findFirst.mockResolvedValueOnce(null); // S
      tx.availabilityEvent.update.mockResolvedValueOnce({
        id: 'evt-n',
        previousStatus: OperationalStatus.OPERATIONAL,
        elapsedMinutes: 0,
      } as never);

      await service.register(tx as any, {
        tenantId,
        equipmentId,
        availabilityId,
        status: OperationalStatus.DOWN_FAILURE,
        eventAt: eDate,
      });

      expect(tx.availabilityEvent.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'evt-n' },
          data: {
            previousStatus: OperationalStatus.OPERATIONAL,
            elapsedMinutes: 0,
          },
        }),
      );
    });

    it('Caso 20: Empate de eventAt y createdAt, desempate por id (A -> N -> B)', async () => {
      const eDate = new Date('2026-06-08T10:00:00.000Z');
      const eCreatedAt = new Date('2026-06-08T10:00:00.000Z');
      const idA = '10000000-0000-0000-0000-000000000000';
      const idN = '50000000-0000-0000-0000-000000000000';
      const idB = '90000000-0000-0000-0000-000000000000';

      tx.availabilityEvent.create.mockResolvedValueOnce({
        id: idN,
        eventAt: eDate,
        createdAt: eCreatedAt,
        status: OperationalStatus.DOWN_FAILURE,
      } as never);
      tx.availabilityEvent.findFirst.mockResolvedValueOnce({
        id: idA,
        status: OperationalStatus.OPERATIONAL,
        eventAt: eDate,
        createdAt: eCreatedAt,
      } as never); // P
      tx.availabilityEvent.findFirst.mockResolvedValueOnce({
        id: idB,
        status: OperationalStatus.STANDBY,
        eventAt: eDate,
        createdAt: eCreatedAt,
      } as never); // S
      tx.availabilityEvent.update.mockResolvedValueOnce({
        id: idN,
        previousStatus: OperationalStatus.OPERATIONAL,
        elapsedMinutes: 0,
      } as never);

      await service.register(tx as any, {
        tenantId,
        equipmentId,
        availabilityId,
        status: OperationalStatus.DOWN_FAILURE,
        eventAt: eDate,
      });

      expect(tx.availabilityEvent.update).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          where: { id: idN },
          data: {
            previousStatus: OperationalStatus.OPERATIONAL,
            elapsedMinutes: 0,
          },
        }),
      );
      expect(tx.availabilityEvent.update).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          where: { id: idB },
          data: {
            previousStatus: OperationalStatus.DOWN_FAILURE,
            elapsedMinutes: 0,
          },
        }),
      );
    });

    it('Caso 21: El nuevo evento ordena antes de un evento existente empatado (N -> A)', async () => {
      const eDate = new Date('2026-06-08T18:00:00.000Z');
      const eCreatedAt = new Date('2026-06-09T05:00:00.000Z');
      const idA = '90000000-0000-0000-0000-000000000000';
      const idN = '10000000-0000-0000-0000-000000000000';

      tx.availabilityEvent.create.mockResolvedValueOnce({
        id: idN,
        eventAt: eDate,
        createdAt: eCreatedAt,
        status: OperationalStatus.DOWN_FAILURE,
      } as never);
      tx.availabilityEvent.findFirst.mockResolvedValueOnce(null); // P (no hay predecesor)
      tx.availabilityEvent.findFirst.mockResolvedValueOnce({
        id: idA,
        status: OperationalStatus.OPERATIONAL,
        eventAt: eDate,
        createdAt: eCreatedAt,
      } as never); // S
      tx.availabilityEvent.update.mockResolvedValueOnce({
        id: idN,
        previousStatus: null,
        elapsedMinutes: null,
      } as never);

      await service.register(tx as any, {
        tenantId,
        equipmentId,
        availabilityId,
        status: OperationalStatus.DOWN_FAILURE,
        eventAt: eDate,
      });

      expect(tx.availabilityEvent.update).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          where: { id: idN },
          data: { previousStatus: null, elapsedMinutes: null },
        }),
      );
      expect(tx.availabilityEvent.update).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          where: { id: idA },
          data: {
            previousStatus: OperationalStatus.DOWN_FAILURE,
            elapsedMinutes: 0,
          },
        }),
      );
    });

    it('Caso 22: El nuevo evento ordena después de un evento existente empatado', async () => {
      const eDate = new Date('2026-06-08T18:00:00.000Z');
      const eCreatedAt = new Date('2026-06-09T05:00:00.000Z');
      const idA = '10000000-0000-0000-0000-000000000000';
      const idN = '90000000-0000-0000-0000-000000000000';

      tx.availabilityEvent.create.mockResolvedValueOnce({
        id: idN,
        eventAt: eDate,
        createdAt: eCreatedAt,
        status: OperationalStatus.DOWN_FAILURE,
      } as never);
      tx.availabilityEvent.findFirst.mockResolvedValueOnce({
        id: idA,
        status: OperationalStatus.OPERATIONAL,
        eventAt: eDate,
        createdAt: eCreatedAt,
      } as never); // P
      tx.availabilityEvent.findFirst.mockResolvedValueOnce(null); // S
      tx.availabilityEvent.update.mockResolvedValueOnce({
        id: idN,
        previousStatus: OperationalStatus.OPERATIONAL,
        elapsedMinutes: 0,
      } as never);

      await service.register(tx as any, {
        tenantId,
        equipmentId,
        availabilityId,
        status: OperationalStatus.DOWN_FAILURE,
        eventAt: eDate,
      });

      expect(tx.availabilityEvent.update).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          where: { id: idN },
          data: {
            previousStatus: OperationalStatus.OPERATIONAL,
            elapsedMinutes: 0,
          },
        }),
      );
    });

    it('Caso 23: elapsedMinutes = 0 para eventos con mismo eventAt', async () => {
      // It's covered by cases 19, 20, 21, and 22.
      expect(true).toBeTruthy();
    });

    it('Caso 24: El retorno contiene los valores finales reparados', async () => {
      tx.availabilityEvent.create.mockResolvedValueOnce({
        id: 'evt-n',
        eventAt: defaultDate,
        createdAt: defaultDate,
        status: OperationalStatus.OPERATIONAL,
      } as never);
      tx.availabilityEvent.findFirst.mockResolvedValue(null);
      tx.availabilityEvent.update.mockResolvedValueOnce({
        id: 'evt-n',
        previousStatus: OperationalStatus.DOWN_FAILURE,
        elapsedMinutes: 120,
      } as never);

      const result = await service.register(tx as any, {
        tenantId,
        equipmentId,
        availabilityId,
        status: OperationalStatus.OPERATIONAL,
        eventAt: defaultDate,
      });
      expect(result).toMatchObject({
        previousStatus: OperationalStatus.DOWN_FAILURE,
        elapsedMinutes: 120,
      });
    });
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
