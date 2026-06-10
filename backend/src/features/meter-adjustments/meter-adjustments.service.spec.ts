import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import { MeterLogSource, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MeterAdjustmentsService } from './meter-adjustments.service';

jest.mock('../equipments/equipment-meter-sync', () => ({
  applyCurrentMeterChange: jest.fn().mockResolvedValue(undefined),
}));

import { applyCurrentMeterChange } from '../equipments/equipment-meter-sync';

const mockApplyMeterChange = jest.mocked(applyCurrentMeterChange);

describe('MeterAdjustmentsService', () => {
  let service: MeterAdjustmentsService;
  let prisma: DeepMockProxy<PrismaService>;
  let tx: DeepMockProxy<Prisma.TransactionClient>;

  const tenantId = '11111111-1111-1111-1111-111111111111';
  const equipId = '22222222-2222-2222-2222-222222222222';
  const userId = '33333333-3333-3333-3333-333333333333';
  const adjustmentId = '44444444-4444-4444-4444-444444444444';

  const user = { id: userId, tenantId };

  beforeEach(async () => {
    prisma = mockDeep<PrismaService>();
    tx = mockDeep<Prisma.TransactionClient>();
    mockApplyMeterChange.mockClear();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MeterAdjustmentsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(MeterAdjustmentsService);
  });

  describe('create', () => {
    it('rechaza lectura menor al medidor actual sin justificación de motor', async () => {
      prisma.equipment.findFirst.mockResolvedValue({
        id: equipId,
        tenantId,
        currentMeter: 8000,
      } as never);

      await expect(
        service.create(user, {
          equipmentId: equipId,
          oldValue: 8000,
          newValue: 100,
          reason: 'corto',
        }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.create(user, {
          equipmentId: equipId,
          oldValue: 8000,
          newValue: 100,
        }),
      ).rejects.toThrow(/cambio de motor/i);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('permite reinicio con justificación de cambio de motor en BD', async () => {
      prisma.equipment.findFirst.mockResolvedValue({
        id: equipId,
        tenantId,
        currentMeter: 8000,
      } as never);
      prisma.$transaction.mockImplementation(async (fn) => {
        tx.meterAdjustment.create.mockResolvedValue({
          id: adjustmentId,
          equipmentId: equipId,
          oldValue: 8000,
          newValue: 0,
          reason: 'Cambio de motor completo — reinicio horómetro',
        } as never);
        return (fn as (client: typeof tx) => Promise<unknown>)(tx);
      });

      const row = await service.create(user, {
        equipmentId: equipId,
        oldValue: 8000,
        newValue: 0,
        reason: 'Cambio de motor completo — reinicio horómetro',
      });

      expect(row.newValue).toBe(0);
      expect(tx.meterAdjustment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            newValue: 0,
            reason: expect.stringContaining('motor'),
          }),
        }),
      );
      expect(mockApplyMeterChange).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          equipmentId: equipId,
          oldMeter: 8000,
          newMeter: 0,
          source: MeterLogSource.MANUAL,
          sourceId: adjustmentId,
        }),
      );
    });

    it('rechaza equipo inexistente', async () => {
      prisma.equipment.findFirst.mockResolvedValue(null);

      await expect(
        service.create(user, {
          equipmentId: equipId,
          oldValue: 0,
          newValue: 100,
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
