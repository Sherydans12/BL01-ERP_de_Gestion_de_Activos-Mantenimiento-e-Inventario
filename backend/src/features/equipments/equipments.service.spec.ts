import { Test, TestingModule } from '@nestjs/testing';
import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import { MeterLogSource, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EquipmentsService } from './equipments.service';

jest.mock('./equipment-meter-sync', () => ({
  applyCurrentMeterChange: jest.fn().mockResolvedValue(undefined),
}));

import { applyCurrentMeterChange } from './equipment-meter-sync';

const mockApplyMeterChange = jest.mocked(applyCurrentMeterChange);

describe('EquipmentsService', () => {
  let service: EquipmentsService;
  let prisma: DeepMockProxy<PrismaService>;
  let tx: DeepMockProxy<Prisma.TransactionClient>;

  const tenantId = '11111111-1111-1111-1111-111111111111';
  const contractAllowed = '22222222-2222-2222-2222-222222222222';
  const contractForbidden = '33333333-3333-3333-3333-333333333333';
  const equipId = '44444444-4444-4444-4444-444444444444';
  const userId = '55555555-5555-5555-5555-555555555555';

  const userScoped = {
    id: userId,
    tenantId,
    role: 'USER',
    allowedContracts: [contractAllowed],
  };

  beforeEach(async () => {
    prisma = mockDeep<PrismaService>();
    tx = mockDeep<Prisma.TransactionClient>();
    mockApplyMeterChange.mockClear();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EquipmentsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(EquipmentsService);
  });

  describe('create', () => {
    const basePayload = {
      contractId: contractAllowed,
      subcontractId: null,
      internalId: 'EQ-001',
      plate: 'AA-BB-11',
      type: 'CAMION',
      brand: 'Volvo',
      model: 'FMX',
      meterType: 'HORAS',
      initialMeter: 100,
      currentMeter: 100,
    };

    it('rechaza USER sin contrato en allowedContracts', async () => {
      await expect(
        service.create(userScoped, {
          ...basePayload,
          contractId: contractForbidden,
        }),
      ).rejects.toThrow(/sin permisos sobre el contrato/i);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('crea equipo cuando el contrato está en allowedContracts', async () => {
      prisma.subcontract.count.mockResolvedValue(0);
      prisma.$transaction.mockImplementation(async (fn) => {
        tx.equipment.create.mockResolvedValue({
          id: equipId,
          tenantId,
          ...basePayload,
          initialMeter: 100,
          currentMeter: 100,
        } as never);
        return (fn as (client: typeof tx) => Promise<unknown>)(tx);
      });

      const row = await service.create(userScoped, basePayload);

      expect(row).toMatchObject({ id: equipId });
      expect(tx.equipment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId,
            contractId: contractAllowed,
          }),
        }),
      );
    });
  });

  describe('update', () => {
    it('rechaza USER si el equipo no está en su alcance de contrato', async () => {
      prisma.equipment.findFirst.mockResolvedValue(null);

      await expect(
        service.update(
          userScoped,
          equipId,
          { brand: 'Caterpillar' },
          undefined,
        ),
      ).rejects.toThrow(/no encontrado o sin permisos/i);
    });

    it('actualiza cuando el equipo pertenece a un contrato permitido', async () => {
      prisma.equipment.findFirst.mockResolvedValue({
        id: equipId,
        tenantId,
        contractId: contractAllowed,
        subcontractId: null,
        currentMeter: 500,
        isSubleased: false,
        subleaseCompanyName: null,
      } as never);
      prisma.subcontract.count.mockResolvedValue(0);
      prisma.equipment.update.mockResolvedValue({
        id: equipId,
        contractId: contractAllowed,
        brand: 'Caterpillar',
      } as never);

      const row = await service.update(
        userScoped,
        equipId,
        { brand: 'Caterpillar' },
        undefined,
      );

      expect(row).toMatchObject({ brand: 'Caterpillar' });
    });
  });

  describe('bulkSyncMeterReadings', () => {
    function buildItems(
      okCount: number,
      failLower: string[],
      failMissing: string[] = [],
    ) {
      const items: { equipmentId: string; newReading: number }[] = [];
      for (let i = 0; i < okCount; i++) {
        items.push({
          equipmentId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
          newReading: 1001 + i,
        });
      }
      for (const id of failLower) {
        items.push({ equipmentId: id, newReading: 50 });
      }
      for (const id of failMissing) {
        items.push({ equipmentId: id, newReading: 2000 });
      }
      return items;
    }

    it('procesa 50 lecturas OK y 2 erróneas sin abortar el lote', async () => {
      const failIds = [
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0001',
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbb0002',
      ];
      const items = buildItems(50, failIds);

      prisma.$transaction.mockImplementation(async (fn) => {
        tx.equipment.findFirst.mockImplementation(async (args) => {
          const id = (args as { where: { id: string } }).where.id;
          if (failIds.includes(id)) {
            return {
              id,
              tenantId,
              internalId: `INT-${id.slice(0, 8)}`,
              currentMeter: 500,
            } as never;
          }
          if (id.startsWith('00000000-0000-4000-8000-')) {
            const idx = Number(id.slice(-12));
            return {
              id,
              tenantId,
              internalId: `INT-${idx}`,
              currentMeter: 1000 + idx,
            } as never;
          }
          return null;
        });
        return (fn as (client: typeof tx) => Promise<unknown>)(tx);
      });

      const result = await service.bulkSyncMeterReadings(
        { id: userId, tenantId, role: 'ADMIN' },
        undefined,
        { items },
      );

      expect(result.successCount).toBe(50);
      expect(result.errors).toHaveLength(2);
      expect(result.errors.map((e) => e.equipmentId).sort()).toEqual(
        [...failIds].sort(),
      );
      expect(
        result.errors.every((e) => e.error === 'READING_LOWER_THAN_CURRENT'),
      ).toBe(true);
      expect(mockApplyMeterChange).toHaveBeenCalledTimes(50);
      expect(mockApplyMeterChange).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          tenantId,
          source: MeterLogSource.MANUAL,
          userId,
        }),
      );
    });

    it('acumula EQUIPMENT_NOT_FOUND_OR_FORBIDDEN sin detener el resto', async () => {
      const missingId = 'cccccccc-cccc-4ccc-8ccc-cccccccc0003';
      const items = [
        {
          equipmentId: 'dddddddd-dddd-4ddd-8ddd-dddddddd0004',
          newReading: 1010,
        },
        { equipmentId: missingId, newReading: 1010 },
      ];

      prisma.$transaction.mockImplementation(async (fn) => {
        tx.equipment.findFirst.mockImplementation(async (args) => {
          const id = (args as { where: { id: string } }).where.id;
          if (id === missingId) return null;
          return {
            id,
            tenantId,
            internalId: 'INT-1',
            currentMeter: 1000,
          } as never;
        });
        return (fn as (client: typeof tx) => Promise<unknown>)(tx);
      });

      const result = await service.bulkSyncMeterReadings(
        { id: userId, tenantId, role: 'ADMIN' },
        undefined,
        { items },
      );

      expect(result.successCount).toBe(1);
      expect(result.errors).toEqual([
        {
          equipmentId: missingId,
          error: 'EQUIPMENT_NOT_FOUND_OR_FORBIDDEN',
        },
      ]);
    });

    it('retiene salto de 25 h sin confirmedLargeJump con READING_JUMP_REQUIRES_CONFIRMATION', async () => {
      const equipmentId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeee0005';
      prisma.$transaction.mockImplementation(async (fn) => {
        tx.equipment.findFirst.mockResolvedValue({
          id: equipmentId,
          tenantId,
          internalId: 'INT-JUMP',
          currentMeter: 1000,
          meterType: 'HOURS',
        } as never);
        return (fn as (client: typeof tx) => Promise<unknown>)(tx);
      });

      const result = await service.bulkSyncMeterReadings(
        { id: userId, tenantId, role: 'ADMIN' },
        undefined,
        {
          items: [{ equipmentId, newReading: 1025 }],
        },
      );

      expect(result.successCount).toBe(0);
      expect(result.errors).toEqual([
        {
          equipmentId,
          error: 'READING_JUMP_REQUIRES_CONFIRMATION',
          serverValue: 1000,
          delta: 25,
        },
      ]);
      expect(mockApplyMeterChange).not.toHaveBeenCalled();
    });

    it('procesa salto de 25 h cuando confirmedLargeJump es true', async () => {
      const equipmentId = 'ffffffff-ffff-4fff-8fff-ffffffff0006';
      prisma.$transaction.mockImplementation(async (fn) => {
        tx.equipment.findFirst.mockResolvedValue({
          id: equipmentId,
          tenantId,
          internalId: 'INT-JUMP-OK',
          currentMeter: 1000,
          meterType: 'HOURS',
        } as never);
        return (fn as (client: typeof tx) => Promise<unknown>)(tx);
      });

      const result = await service.bulkSyncMeterReadings(
        { id: userId, tenantId, role: 'ADMIN' },
        undefined,
        {
          items: [
            {
              equipmentId,
              newReading: 1025,
              confirmedLargeJump: true,
            },
          ],
        },
      );

      expect(result.successCount).toBe(1);
      expect(result.errors).toHaveLength(0);
      expect(mockApplyMeterChange).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          equipmentId,
          oldMeter: 1000,
          newMeter: 1025,
          source: MeterLogSource.MANUAL,
        }),
      );
    });
  });

  describe('getAnalytics', () => {
    it('incluye los repuestos (parts) de las OT cerradas y los devuelve (Sprint 2.1)', async () => {
      const equipmentMock = {
        id: equipId,
        tenantId,
        internalId: 'EC-1',
      };
      const woMock = {
        id: 'wo-1',
        correlative: 'OT-100',
        status: 'CLOSED',
        closedAt: new Date(),
        parts: [
          {
            id: 'p1',
            partNumber: 'FIL-01',
            description: 'Filtro de aceite',
            quantity: 2,
            unitCost: 5000,
            inventoryItemId: null,
          },
        ],
      };

      // $transaction en forma de array → resolvemos los 5 resultados.
      // meterLogs vacío para evitar el findMany de enriquecimiento (woMap).
      prisma.$transaction.mockResolvedValue([
        equipmentMock,
        [woMock],
        [],
        [],
        [],
      ] as never);

      const res = await service.getAnalytics(userScoped, equipId);

      expect(prisma.workOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            equipmentId: equipId,
            status: 'CLOSED',
          }),
          include: expect.objectContaining({
            parts: expect.objectContaining({
              select: expect.objectContaining({
                partNumber: true,
                unitCost: true,
                quantity: true,
              }),
            }),
          }),
        }),
      );
      expect(res.workOrders[0].parts[0].partNumber).toBe('FIL-01');
      expect(res.workOrders[0].parts[0].unitCost).toBe(5000);
    });
  });
});
