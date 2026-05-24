import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../../common/email/email.service';
import { WorkOrdersService } from './work-orders.service';
import {
  getPolicyThresholdsForNewItemStockRow,
  clearItemStockPolicyIfMatchesWarehouse,
} from '../inventory-items/inventory-item-stock-policy.helper';

jest.mock('../equipments/equipment-meter-sync', () => ({
  applyCurrentMeterChange: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../inventory-items/inventory-item-stock-policy.helper');

import { applyCurrentMeterChange } from '../equipments/equipment-meter-sync';

const mockApplyCurrentMeterChange = jest.mocked(applyCurrentMeterChange);
const mockGetPolicyThresholds = jest.mocked(getPolicyThresholdsForNewItemStockRow);
const mockClearItemStockPolicy = jest.mocked(clearItemStockPolicyIfMatchesWarehouse);

describe('WorkOrdersService — updateStatus (CLOSED)', () => {
  let service: WorkOrdersService;
  let prisma: DeepMockProxy<PrismaService>;
  let tx: DeepMockProxy<Prisma.TransactionClient>;

  const tenantId = '11111111-1111-1111-1111-111111111111';
  const woId = '22222222-2222-2222-2222-222222222222';
  const equipId = '33333333-3333-3333-3333-333333333333';
  const warehouseId = '44444444-4444-4444-4444-444444444444';
  const itemId = '55555555-5555-5555-5555-555555555555';
  const fluidItemId = '77777777-7777-4777-8777-777777777777';
  const userId = '66666666-6666-6666-6666-666666666666';

  const user = { id: userId, tenantId, role: 'ADMIN' };

  const detentionStart = new Date('2024-06-01T08:00:00.000Z');
  const detentionEnd = new Date('2024-06-01T12:00:00.000Z');

  function openWorkOrder(
    overrides: Partial<{
      status: string;
      warehouseId: string | null;
      parts: unknown[];
      fluidCompartments: unknown[];
      finalMeter: number | null;
      initialMeter: number;
    }> = {},
  ) {
    return {
      id: woId,
      tenantId,
      status: overrides.status ?? 'IN_PROGRESS',
      correlative: 'OT-100',
      equipmentId: equipId,
      warehouseId: overrides.warehouseId ?? null,
      personnelQuantity: 1,
      detentionStartedAt: detentionStart,
      detentionEndedAt: detentionEnd,
      mechanicAttentionStartedAt: detentionStart,
      mechanicAttentionEndedAt: detentionEnd,
      initialMeter: overrides.initialMeter ?? 1000,
      finalMeter: overrides.finalMeter ?? null,
      affectsAvailability: 'NO',
      classificationTags: [] as string[],
      equipment: {
        currentMeter: 1000,
        internalId: 'EQ-01',
        brand: 'Cat',
        model: 'M1',
      },
      parts: overrides.parts ?? [
        {
          id: 'part-1',
          inventoryItemId: itemId,
          quantity: 2,
          partNumber: 'PN-REP',
          inventoryItem: { isInventory: true },
        },
      ],
      fluidCompartments: overrides.fluidCompartments ?? [],
    };
  }

  beforeEach(async () => {
    prisma = mockDeep<PrismaService>();
    tx = mockDeep<Prisma.TransactionClient>();
    mockGetPolicyThresholds.mockResolvedValue({ minStock: 0, maxStock: 0 });
    mockClearItemStockPolicy.mockResolvedValue(undefined);
    mockApplyCurrentMeterChange.mockClear();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkOrdersService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('') } },
        { provide: EmailService, useValue: { sendMail: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();

    service = module.get(WorkOrdersService);
  });

  it('exige bodega si hay repuestos de inventario al cerrar', async () => {
    prisma.$transaction.mockImplementation(async (fn) => {
      tx.workOrder.findFirst.mockResolvedValue(openWorkOrder() as never);
      return (fn as (client: typeof tx) => Promise<unknown>)(tx);
    });

    await expect(
      service.updateStatus(user, woId, {
        status: 'CLOSED',
        closureEquipmentOperational: true,
      }),
    ).rejects.toThrow(/bodega de origen/);
  });

  it('rechaza cierre si la OT ya está CLOSED', async () => {
    prisma.$transaction.mockImplementation(async (fn) => {
      tx.workOrder.findFirst.mockResolvedValue(
        openWorkOrder({ status: 'CLOSED' }) as never,
      );
      return (fn as (client: typeof tx) => Promise<unknown>)(tx);
    });

    await expect(
      service.updateStatus(user, woId, {
        status: 'CLOSED',
        warehouseId,
        closureEquipmentOperational: true,
      }),
    ).rejects.toThrow(/ya se encuentra CERRADA/);
  });

  it('descuenta stock y registra WORK_ORDER_ISSUE al cerrar con repuestos', async () => {
    const wo = openWorkOrder();
    prisma.$transaction.mockImplementation(async (fn, opts) => {
      expect(opts).toEqual(
        expect.objectContaining({
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        }),
      );
      tx.workOrder.findFirst.mockResolvedValue(wo as never);
      tx.workOrder.update.mockResolvedValue({ ...wo, status: 'CLOSED' } as never);
      tx.itemStock.findUnique.mockResolvedValue({
        quantity: 10,
        unitCost: 25,
      } as never);
      tx.itemStock.upsert.mockResolvedValue({} as never);
      tx.inventoryTransaction.create.mockResolvedValue({} as never);
      tx.workOrderPart.update.mockResolvedValue({} as never);
      tx.stockReservation.deleteMany.mockResolvedValue({ count: 0 } as never);
      tx.equipment.update.mockResolvedValue({} as never);
      return (fn as (client: typeof tx) => Promise<unknown>)(tx);
    });
    prisma.workOrder.findFirst.mockResolvedValue({
      correlative: 'OT-100',
      classificationTags: [],
      equipment: { internalId: 'EQ-01', brand: 'Cat', model: 'M1' },
    } as never);
    prisma.tenant.findUnique.mockResolvedValue({ name: 'Tenant Test' } as never);

    const result = await service.updateStatus(user, woId, {
      status: 'CLOSED',
      warehouseId,
      closureEquipmentOperational: true,
    });

    expect(result.status).toBe('CLOSED');
    expect(tx.inventoryTransaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'WORK_ORDER_ISSUE',
        quantity: 2,
        previousStock: 10,
        newStock: 8,
        referenceType: 'WORK_ORDER',
        referenceId: woId,
      }),
    });
    expect(tx.stockReservation.deleteMany).toHaveBeenCalledWith({
      where: { workOrderId: woId },
    });
  });

  it('exige bodega si hay fluidos de inventario al cerrar', async () => {
    prisma.$transaction.mockImplementation(async (fn) => {
      tx.workOrder.findFirst.mockResolvedValue(
        openWorkOrder({
          parts: [],
          fluidCompartments: [
            {
              compartment: 'Motor',
              liters: 5,
              inventoryItemId: fluidItemId,
              fluidType: 'ACEITE-10W',
              inventoryItem: { isInventory: true, partNumber: 'ACEITE-10W' },
            },
          ],
        }) as never,
      );
      return (fn as (client: typeof tx) => Promise<unknown>)(tx);
    });

    await expect(
      service.updateStatus(user, woId, {
        status: 'CLOSED',
        closureEquipmentOperational: true,
      }),
    ).rejects.toThrow(/bodega de origen/);
  });

  it('descuenta fluidos con WORK_ORDER_ISSUE al cerrar', async () => {
    const wo = openWorkOrder({
      parts: [],
      fluidCompartments: [
        {
          compartment: 'Hidráulico',
          liters: 3.5,
          inventoryItemId: fluidItemId,
          fluidType: 'HID-OIL',
          inventoryItem: { isInventory: true, partNumber: 'HID-OIL' },
        },
      ],
    });

    prisma.$transaction.mockImplementation(async (fn) => {
      tx.workOrder.findFirst.mockResolvedValue(wo as never);
      tx.workOrder.update.mockResolvedValue({ ...wo, status: 'CLOSED' } as never);
      tx.itemStock.findUnique.mockResolvedValue({ quantity: 20, unitCost: 12 } as never);
      tx.itemStock.upsert.mockResolvedValue({} as never);
      tx.inventoryTransaction.create.mockResolvedValue({} as never);
      tx.stockReservation.deleteMany.mockResolvedValue({ count: 0 } as never);
      tx.equipment.update.mockResolvedValue({} as never);
      return (fn as (client: typeof tx) => Promise<unknown>)(tx);
    });
    prisma.workOrder.findFirst.mockResolvedValue({
      correlative: 'OT-100',
      classificationTags: [],
      equipment: { internalId: 'EQ-01', brand: 'Cat', model: 'M1' },
    } as never);
    prisma.tenant.findUnique.mockResolvedValue({ name: 'Tenant Test' } as never);

    await service.updateStatus(user, woId, {
      status: 'CLOSED',
      warehouseId,
      closureEquipmentOperational: true,
    });

    expect(tx.inventoryTransaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'WORK_ORDER_ISSUE',
        quantity: 3.5,
        notes: expect.stringContaining('Consumo fluido OT OT-100'),
      }),
    });
  });

  it('rechaza medidor final menor al inicial sin ajuste previo', async () => {
    prisma.$transaction.mockImplementation(async (fn) => {
      tx.workOrder.findFirst.mockResolvedValue(
        openWorkOrder({
          parts: [],
          finalMeter: 500,
          initialMeter: 1000,
        }) as never,
      );
      tx.meterAdjustment.findFirst.mockResolvedValue(null);
      return (fn as (client: typeof tx) => Promise<unknown>)(tx);
    });

    await expect(
      service.updateStatus(user, woId, {
        status: 'CLOSED',
        warehouseId,
        closureEquipmentOperational: true,
      }),
    ).rejects.toThrow(/medidor final/);
  });

  it('sincroniza medidor del equipo al cerrar con finalMeter', async () => {
    const wo = openWorkOrder({ parts: [], finalMeter: 1500 });

    prisma.$transaction.mockImplementation(async (fn) => {
      tx.workOrder.findFirst.mockResolvedValue(wo as never);
      tx.workOrder.update.mockResolvedValue({ ...wo, status: 'CLOSED' } as never);
      tx.stockReservation.deleteMany.mockResolvedValue({ count: 0 } as never);
      tx.equipment.update.mockResolvedValue({} as never);
      return (fn as (client: typeof tx) => Promise<unknown>)(tx);
    });
    prisma.workOrder.findFirst.mockResolvedValue({
      correlative: 'OT-100',
      classificationTags: [],
      equipment: { internalId: 'EQ-01', brand: 'Cat', model: 'M1' },
    } as never);
    prisma.tenant.findUnique.mockResolvedValue({ name: 'Tenant Test' } as never);

    await service.updateStatus(user, woId, {
      status: 'CLOSED',
      warehouseId,
      closureEquipmentOperational: false,
    });

    expect(mockApplyCurrentMeterChange).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        tenantId,
        equipmentId: equipId,
        oldMeter: 1000,
        newMeter: 1500,
        sourceId: woId,
      }),
    );
  });

  it('envía correo de garantía si la OT tiene POSIBLE_GARANTIA', async () => {
    const wo = openWorkOrder({ parts: [] });
    const configGet = jest.fn().mockReturnValue('garantia@empresa.cl');
    const sendMail = jest.fn().mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkOrdersService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: configGet } },
        { provide: EmailService, useValue: { sendMail } },
      ],
    }).compile();
    service = module.get(WorkOrdersService);

    prisma.$transaction.mockImplementation(async (fn) => {
      tx.workOrder.findFirst.mockResolvedValue(wo as never);
      tx.workOrder.update.mockResolvedValue({ ...wo, status: 'CLOSED' } as never);
      tx.stockReservation.deleteMany.mockResolvedValue({ count: 0 } as never);
      tx.equipment.update.mockResolvedValue({} as never);
      return (fn as (client: typeof tx) => Promise<unknown>)(tx);
    });
    prisma.workOrder.findFirst.mockResolvedValue({
      correlative: 'OT-100',
      classificationTags: ['POSIBLE_GARANTIA'],
      equipment: { internalId: 'EQ-01', brand: 'Cat', model: 'M1' },
    } as never);
    prisma.tenant.findUnique.mockResolvedValue({ name: 'Acme Minera' } as never);

    await service.updateStatus(user, woId, {
      status: 'CLOSED',
      closureEquipmentOperational: true,
    });

    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ['garantia@empresa.cl'],
        subject: expect.stringContaining('OT-100'),
      }),
    );
  });
});
