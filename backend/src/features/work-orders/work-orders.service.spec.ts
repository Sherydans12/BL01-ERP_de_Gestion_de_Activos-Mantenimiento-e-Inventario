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
      detentionStartedAt: Date | null;
      detentionEndedAt: Date | null;
      mechanicAttentionStartedAt: Date | null;
      mechanicAttentionEndedAt: Date | null;
      affectsAvailability: string;
      personnelQuantity: number;
    }> = {},
  ) {
    return {
      id: woId,
      tenantId,
      status: overrides.status ?? 'IN_PROGRESS',
      correlative: 'OT-100',
      equipmentId: equipId,
      warehouseId: overrides.warehouseId ?? null,
      personnelQuantity: overrides.personnelQuantity ?? 1,
      detentionStartedAt:
        'detentionStartedAt' in overrides
          ? overrides.detentionStartedAt
          : detentionStart,
      detentionEndedAt:
        'detentionEndedAt' in overrides ? overrides.detentionEndedAt : detentionEnd,
      mechanicAttentionStartedAt:
        'mechanicAttentionStartedAt' in overrides
          ? overrides.mechanicAttentionStartedAt
          : detentionStart,
      mechanicAttentionEndedAt:
        'mechanicAttentionEndedAt' in overrides
          ? overrides.mechanicAttentionEndedAt
          : detentionEnd,
      initialMeter: overrides.initialMeter ?? 1000,
      finalMeter: overrides.finalMeter ?? null,
      affectsAvailability: overrides.affectsAvailability ?? 'NO',
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

  it('rechaza cierre sin fechas de detención', async () => {
    prisma.$transaction.mockImplementation(async (fn) => {
      tx.workOrder.findFirst.mockResolvedValue(
        openWorkOrder({ parts: [], detentionStartedAt: null }) as never,
      );
      return (fn as (client: typeof tx) => Promise<unknown>)(tx);
    });

    await expect(
      service.updateStatus(user, woId, {
        status: 'CLOSED',
        warehouseId,
        closureEquipmentOperational: true,
      }),
    ).rejects.toThrow(/inicio y fin de detención/);
  });

  it('rechaza fin de detención anterior al inicio', async () => {
    prisma.$transaction.mockImplementation(async (fn) => {
      tx.workOrder.findFirst.mockResolvedValue(
        openWorkOrder({
          parts: [],
          detentionStartedAt: detentionEnd,
          detentionEndedAt: detentionStart,
        }) as never,
      );
      return (fn as (client: typeof tx) => Promise<unknown>)(tx);
    });

    await expect(
      service.updateStatus(user, woId, {
        status: 'CLOSED',
        warehouseId,
        closureEquipmentOperational: true,
      }),
    ).rejects.toThrow(/fin de detención debe ser posterior/);
  });

  it('rechaza fin de atención mecánica anterior al inicio', async () => {
    prisma.$transaction.mockImplementation(async (fn) => {
      tx.workOrder.findFirst.mockResolvedValue(
        openWorkOrder({
          parts: [],
          mechanicAttentionStartedAt: detentionEnd,
          mechanicAttentionEndedAt: detentionStart,
        }) as never,
      );
      return (fn as (client: typeof tx) => Promise<unknown>)(tx);
    });

    await expect(
      service.updateStatus(user, woId, {
        status: 'CLOSED',
        warehouseId,
        closureEquipmentOperational: true,
      }),
    ).rejects.toThrow(/fin de atención mecánica debe ser posterior/);
  });

  it('incrementa cumulativeDowntimeHours si affectsAvailability es SI', async () => {
    const wo = openWorkOrder({ parts: [], affectsAvailability: 'SI' });
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
      closureEquipmentOperational: true,
    });

    expect(tx.equipment.update).toHaveBeenCalledWith({
      where: { id: equipId },
      data: expect.objectContaining({
        isOperational: true,
        cumulativeDowntimeHours: { increment: 4 },
      }),
    });
  });

  it('rechaza cierre sin atención mecánica', async () => {
    prisma.$transaction.mockImplementation(async (fn) => {
      tx.workOrder.findFirst.mockResolvedValue(
        openWorkOrder({ parts: [], mechanicAttentionEndedAt: null }) as never,
      );
      return (fn as (client: typeof tx) => Promise<unknown>)(tx);
    });

    await expect(
      service.updateStatus(user, woId, {
        status: 'CLOSED',
        warehouseId,
        closureEquipmentOperational: true,
      }),
    ).rejects.toThrow(/atención mecánica/);
  });

  it('exige indicar si el equipo quedó operativo al cerrar', async () => {
    prisma.$transaction.mockImplementation(async (fn) => {
      tx.workOrder.findFirst.mockResolvedValue(openWorkOrder({ parts: [] }) as never);
      return (fn as (client: typeof tx) => Promise<unknown>)(tx);
    });

    await expect(
      service.updateStatus(user, woId, {
        status: 'CLOSED',
        warehouseId,
      }),
    ).rejects.toThrow(/equipo quedó operativo/);
  });

  it('registra assetCostRecord por consumibles al cerrar con repuestos', async () => {
    const wo = openWorkOrder();
    prisma.$transaction.mockImplementation(async (fn) => {
      tx.workOrder.findFirst.mockResolvedValue(wo as never);
      tx.workOrder.update.mockResolvedValue({ ...wo, status: 'CLOSED' } as never);
      tx.itemStock.findUnique.mockResolvedValue({ quantity: 10, unitCost: 25 } as never);
      tx.itemStock.upsert.mockResolvedValue({} as never);
      tx.inventoryTransaction.create.mockResolvedValue({} as never);
      tx.workOrderPart.update.mockResolvedValue({} as never);
      tx.assetCostRecord.create.mockResolvedValue({} as never);
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

    expect(tx.assetCostRecord.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId,
        equipmentId: equipId,
        type: 'WORK_ORDER',
        workOrderId: woId,
        amount: '50.00',
      }),
    });
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

describe('WorkOrdersService — updateStatus (IN_PROGRESS)', () => {
  let service: WorkOrdersService;
  let prisma: DeepMockProxy<PrismaService>;

  const tenantId = '11111111-1111-1111-1111-111111111111';
  const woId = '22222222-2222-2222-2222-222222222222';
  const equipId = '33333333-3333-3333-3333-333333333333';
  const userId = '66666666-6666-6666-6666-666666666666';
  const user = { id: userId, tenantId, role: 'ADMIN' };

  beforeEach(async () => {
    prisma = mockDeep<PrismaService>();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkOrdersService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('') } },
        { provide: EmailService, useValue: { sendMail: jest.fn() } },
      ],
    }).compile();
    service = module.get(WorkOrdersService);
  });

  it('marca equipo no operativo al iniciar OT con affectsAvailability SI', async () => {
    const wo = {
      id: woId,
      tenantId,
      status: 'OPEN',
      equipmentId: equipId,
      affectsAvailability: 'SI',
      inProgressAt: null,
    };
    prisma.workOrder.findFirst.mockResolvedValue(wo as never);
    prisma.workOrder.update.mockResolvedValue({
      ...wo,
      status: 'IN_PROGRESS',
      inProgressAt: new Date(),
    } as never);
    prisma.equipment.update.mockResolvedValue({} as never);

    await service.updateStatus(user, woId, { status: 'IN_PROGRESS' });

    expect(prisma.equipment.update).toHaveBeenCalledWith({
      where: { id: equipId },
      data: { isOperational: false },
    });
    expect(prisma.workOrder.update).toHaveBeenCalledWith({
      where: { id: woId },
      data: expect.objectContaining({
        status: 'IN_PROGRESS',
        inProgressAt: expect.any(Date),
      }),
    });
  });

  it('no altera equipo si affectsAvailability es NO', async () => {
    const wo = {
      id: woId,
      tenantId,
      status: 'OPEN',
      equipmentId: equipId,
      affectsAvailability: 'NO',
      inProgressAt: null,
    };
    prisma.workOrder.findFirst.mockResolvedValue(wo as never);
    prisma.workOrder.update.mockResolvedValue({ ...wo, status: 'IN_PROGRESS' } as never);

    await service.updateStatus(user, woId, { status: 'IN_PROGRESS' });

    expect(prisma.equipment.update).not.toHaveBeenCalled();
  });

  it('no vuelve a marcar equipo si la OT ya está IN_PROGRESS', async () => {
    const existingProgressAt = new Date('2024-05-01T10:00:00.000Z');
    const wo = {
      id: woId,
      tenantId,
      status: 'IN_PROGRESS',
      equipmentId: equipId,
      affectsAvailability: 'SI',
      inProgressAt: existingProgressAt,
    };
    prisma.workOrder.findFirst.mockResolvedValue(wo as never);
    prisma.workOrder.update.mockResolvedValue(wo as never);

    await service.updateStatus(user, woId, { status: 'IN_PROGRESS' });

    expect(prisma.equipment.update).not.toHaveBeenCalled();
    expect(prisma.workOrder.update).toHaveBeenCalledWith({
      where: { id: woId },
      data: { status: 'IN_PROGRESS' },
    });
  });

  it('rechaza transición si la OT no existe', async () => {
    prisma.workOrder.findFirst.mockResolvedValue(null);

    await expect(
      service.updateStatus(user, woId, { status: 'IN_PROGRESS' }),
    ).rejects.toThrow(/Orden no encontrada/);
  });
});

describe('WorkOrdersService — promoteBacklogItem', () => {
  let service: WorkOrdersService;
  let prisma: DeepMockProxy<PrismaService>;

  const tenantId = '11111111-1111-1111-1111-111111111111';
  const woId = '22222222-2222-2222-2222-222222222222';
  const itemId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const equipId = '33333333-3333-3333-3333-333333333333';
  const userId = '66666666-6666-6666-6666-666666666666';
  const user = { id: userId, tenantId, role: 'ADMIN' };

  beforeEach(async () => {
    prisma = mockDeep<PrismaService>();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkOrdersService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('') } },
        { provide: EmailService, useValue: { sendMail: jest.fn() } },
      ],
    }).compile();
    service = module.get(WorkOrdersService);
  });

  it('rechaza si el ítem de backlog no está PENDING', async () => {
    prisma.workOrder.findFirst.mockResolvedValue({
      id: woId,
      equipmentId: equipId,
      equipment: { currentMeter: 1000 },
    } as never);
    prisma.workOrderBacklogItem.findFirst.mockResolvedValue({
      id: itemId,
      status: 'DONE',
      description: 'Revisar bomba',
    } as never);

    await expect(
      service.promoteBacklogItem(user, woId, itemId, { mode: 'TO_TASK' }),
    ).rejects.toThrow(/estado pendiente/);
  });

  it('promueve backlog a tarea en la misma OT (TO_TASK)', async () => {
    prisma.workOrder.findFirst.mockResolvedValue({
      id: woId,
      equipmentId: equipId,
      equipment: { currentMeter: 1000 },
    } as never);
    prisma.workOrderBacklogItem.findFirst.mockResolvedValue({
      id: itemId,
      status: 'PENDING',
      description: 'Cambiar filtro hidráulico',
    } as never);
    prisma.workOrderTask.create.mockResolvedValue({} as never);
    prisma.workOrderBacklogItem.update.mockResolvedValue({} as never);

    const result = await service.promoteBacklogItem(user, woId, itemId, {
      mode: 'TO_TASK',
    });

    expect(result).toEqual({ promoted: true, mode: 'TO_TASK' });
    expect(prisma.workOrderTask.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workOrderId: woId,
        description: 'Cambiar filtro hidráulico',
        isCompleted: false,
      }),
    });
    expect(prisma.workOrderBacklogItem.update).toHaveBeenCalledWith({
      where: { id: itemId },
      data: { status: 'DONE' },
    });
  });

  it('promueve backlog a nueva OT (TO_NEW_OT)', async () => {
    const newWoId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    prisma.workOrder.findFirst.mockResolvedValue({
      id: woId,
      tenantId,
      equipmentId: equipId,
      warehouseId: null,
      classificationTags: [],
      affectsAvailability: 'NO',
      responsibleMechanicName: 'Juan',
      responsible: null,
      equipment: { currentMeter: 1200 },
      finalMeter: null,
      initialMeter: 1000,
    } as never);
    prisma.workOrderBacklogItem.findFirst.mockResolvedValue({
      id: itemId,
      status: 'PENDING',
      description: 'Falla en transmisión',
    } as never);
    prisma.workOrderBacklogItem.update.mockResolvedValue({} as never);
    const createSpy = jest
      .spyOn(service, 'create')
      .mockResolvedValue({ id: newWoId } as never);

    const result = await service.promoteBacklogItem(user, woId, itemId, {
      mode: 'TO_NEW_OT',
    });

    expect(result).toEqual({
      promoted: true,
      mode: 'TO_NEW_OT',
      newWorkOrderId: newWoId,
    });
    expect(createSpy).toHaveBeenCalledWith(
      user,
      expect.objectContaining({
        equipmentId: equipId,
        workPerformedDescription: 'Falla en transmisión',
      }),
    );
    createSpy.mockRestore();
  });
});
