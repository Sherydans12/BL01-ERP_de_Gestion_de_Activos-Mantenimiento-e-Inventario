import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import { Prisma, TransactionType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryStockService } from '../inventory-stock/inventory-stock.service';
import {
  InventoryTransferService,
  CreateInventoryTransferDto,
} from './inventory-transfer.service';
import {
  getPolicyThresholdsForNewItemStockRow,
  clearItemStockPolicyIfMatchesWarehouse,
} from '../inventory-items/inventory-item-stock-policy.helper';

jest.mock('../inventory-items/inventory-item-stock-policy.helper');

const mockGetPolicyThresholds = jest.mocked(
  getPolicyThresholdsForNewItemStockRow,
);
const mockClearItemStockPolicy = jest.mocked(
  clearItemStockPolicyIfMatchesWarehouse,
);

describe('InventoryTransferService', () => {
  let service: InventoryTransferService;
  let prisma: DeepMockProxy<PrismaService>;
  let tx: DeepMockProxy<Prisma.TransactionClient>;
  let stockService: DeepMockProxy<InventoryStockService>;

  const tenantId = '11111111-1111-1111-1111-111111111111';
  const originId = '22222222-2222-2222-2222-222222222222';
  const destId = '33333333-3333-3333-3333-333333333333';
  const itemId = '44444444-4444-4444-4444-444444444444';
  const userId = '55555555-5555-5555-5555-555555555555';
  const transferId = '66666666-6666-6666-6666-666666666666';
  const destContractId = '77777777-7777-7777-7777-777777777777';

  const adminUser = {
    id: userId,
    tenantId,
    role: 'ADMIN',
  };

  const supervisorDestAccess = {
    id: userId,
    tenantId,
    role: 'SUPERVISOR',
    allowedContracts: [destContractId],
  };

  const mechanicUser = {
    id: userId,
    tenantId,
    role: 'MECHANIC',
  };

  const baseDto: CreateInventoryTransferDto = {
    originWarehouseId: originId,
    destinationWarehouseId: destId,
    lines: [{ itemId, quantity: 4 }],
  };

  beforeEach(async () => {
    prisma = mockDeep<PrismaService>();
    tx = mockDeep<Prisma.TransactionClient>();
    stockService = mockDeep<InventoryStockService>();

    mockGetPolicyThresholds.mockResolvedValue({ minStock: 0, maxStock: 0 });
    mockClearItemStockPolicy.mockResolvedValue(undefined);
    stockService.clearPendingRegularizationFlags.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventoryTransferService,
        { provide: PrismaService, useValue: prisma },
        { provide: InventoryStockService, useValue: stockService },
      ],
    }).compile();

    service = module.get(InventoryTransferService);
    jest.clearAllMocks();
    mockGetPolicyThresholds.mockResolvedValue({ minStock: 0, maxStock: 0 });
    stockService.clearPendingRegularizationFlags.mockResolvedValue(undefined);
  });

  describe('executeTransfer', () => {
    it('rechaza rol sin privilegio (MECHANIC)', async () => {
      await expect(
        service.executeTransfer(baseDto, mechanicUser),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rechaza usuario sin identificador', async () => {
      await expect(
        service.executeTransfer(baseDto, { tenantId, role: 'ADMIN' }),
      ).rejects.toThrow(/Usuario no identificado/);
    });

    it('rechaza bodega origen o destino inexistente', async () => {
      prisma.$transaction.mockImplementation(async (fn) => {
        tx.warehouse.findFirst
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ id: destId, code: 'DST', tenantId } as never);
        return (fn as (client: typeof tx) => Promise<unknown>)(tx);
      });

      await expect(
        service.executeTransfer(baseDto, adminUser),
      ).rejects.toThrow(NotFoundException);
    });

    it('rechaza origen y destino iguales', async () => {
      await expect(
        service.executeTransfer(
          { ...baseDto, destinationWarehouseId: originId },
          adminUser,
        ),
      ).rejects.toThrow(/deben ser distintas/);
    });

    it('rechaza sin líneas', async () => {
      await expect(
        service.executeTransfer({ ...baseDto, lines: [] }, adminUser),
      ).rejects.toThrow(/al menos una línea/);
    });

    it('rechaza cantidad no positiva', async () => {
      await expect(
        service.executeTransfer(
          { ...baseDto, lines: [{ itemId, quantity: 0 }] },
          adminUser,
        ),
      ).rejects.toThrow(/mayores a cero/);
    });

    it('rechaza fracción cuando la UoM no admite decimales', async () => {
      prisma.$transaction.mockImplementation(async (fn) => {
        tx.warehouse.findFirst
          .mockResolvedValueOnce({ id: originId, code: 'ORI', tenantId } as never)
          .mockResolvedValueOnce({ id: destId, code: 'DST', tenantId } as never);
        tx.inventoryTransfer.create.mockResolvedValue({
          id: transferId,
        } as never);
        tx.inventoryItem.findFirst.mockResolvedValue({
          id: itemId,
          partNumber: 'PN-1',
          unitOfMeasure: { abbreviation: 'UN', allowsDecimals: false },
        } as never);
        return (fn as (client: typeof tx) => Promise<unknown>)(tx);
      });

      await expect(
        service.executeTransfer(
          { ...baseDto, lines: [{ itemId, quantity: 1.5 }] },
          adminUser,
        ),
      ).rejects.toThrow(/no admite fracciones/);
    });

    it('rechaza stock insuficiente en origen', async () => {
      prisma.$transaction.mockImplementation(async (fn) => {
        tx.warehouse.findFirst
          .mockResolvedValueOnce({ id: originId, code: 'ORI' } as never)
          .mockResolvedValueOnce({ id: destId, code: 'DST' } as never);
        tx.inventoryTransfer.create.mockResolvedValue({ id: transferId } as never);
        tx.inventoryItem.findFirst.mockResolvedValue({
          id: itemId,
          partNumber: 'PN-1',
          unitOfMeasure: { abbreviation: 'UN', allowsDecimals: true },
        } as never);
        tx.itemStock.findUnique.mockResolvedValue({
          quantity: 2,
          unitCost: 10,
        } as never);
        return (fn as (client: typeof tx) => Promise<unknown>)(tx);
      });

      await expect(
        service.executeTransfer(baseDto, adminUser),
      ).rejects.toThrow(/Stock insuficiente en origen/);
    });

    it('crea transferencia SHIPPED, descuenta origen y registra TRANSFER_OUT', async () => {
      prisma.$transaction.mockImplementation(async (fn, opts) => {
        expect(opts).toEqual(
          expect.objectContaining({
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          }),
        );
        tx.warehouse.findFirst
          .mockResolvedValueOnce({ id: originId, code: 'B-ORI' } as never)
          .mockResolvedValueOnce({ id: destId, code: 'B-DST' } as never);
        tx.inventoryTransfer.create.mockResolvedValue({
          id: transferId,
          status: 'SHIPPED',
        } as never);
        tx.inventoryItem.findFirst.mockResolvedValue({
          id: itemId,
          partNumber: 'PN-1',
          unitOfMeasure: { abbreviation: 'UN', allowsDecimals: true },
        } as never);
        tx.itemStock.findUnique.mockResolvedValue({
          quantity: 10,
          unitCost: 5,
        } as never);
        tx.itemStock.update.mockResolvedValue({} as never);
        tx.inventoryTransferLine.create.mockResolvedValue({} as never);
        tx.inventoryTransaction.create.mockResolvedValue({} as never);
        tx.inventoryTransfer.findUnique.mockResolvedValue({
          id: transferId,
          status: 'SHIPPED',
          lines: [],
        } as never);
        return (fn as (client: typeof tx) => Promise<unknown>)(tx);
      });

      const result = await service.executeTransfer(baseDto, adminUser);

      expect(result?.status).toBe('SHIPPED');
      expect(tx.itemStock.update).toHaveBeenCalledWith({
        where: {
          warehouseId_itemId: { warehouseId: originId, itemId },
        },
        data: { quantity: 6 },
      });
      expect(tx.inventoryTransaction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: TransactionType.TRANSFER_OUT,
          quantity: 4,
          previousStock: 10,
          newStock: 6,
          referenceType: 'INVENTORY_TRANSFER',
          referenceId: transferId,
          warehouseId: originId,
        }),
      });
      expect(tx.inventoryTransferLine.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          quantity: 4,
          unitCost: 5,
        }),
      });
    });
  });

  describe('confirmReception', () => {
    const shippedTransfer = {
      id: transferId,
      tenantId,
      status: 'SHIPPED',
      originWarehouse: { id: originId, code: 'B-ORI', name: 'Origen', contractId: 'c-ori' },
      destinationWarehouse: {
        id: destId,
        code: 'B-DST',
        name: 'Destino',
        contractId: destContractId,
      },
      lines: [
        {
          itemId,
          quantity: 4,
          unitCost: 5,
        },
      ],
    };

    it('rechaza transferencia inexistente', async () => {
      prisma.$transaction.mockImplementation(async (fn) => {
        tx.inventoryTransfer.findFirst.mockResolvedValue(null);
        return (fn as (client: typeof tx) => Promise<unknown>)(tx);
      });

      await expect(
        service.confirmReception(transferId, supervisorDestAccess),
      ).rejects.toThrow(NotFoundException);
    });

    it('rechaza recepción sin usuario identificado', async () => {
      await expect(
        service.confirmReception(transferId, { tenantId, role: 'ADMIN' }),
      ).rejects.toThrow(/Usuario no identificado/);
    });

    it('rechaza recepción si no está en SHIPPED', async () => {
      prisma.$transaction.mockImplementation(async (fn) => {
        tx.inventoryTransfer.findFirst.mockResolvedValue({
          ...shippedTransfer,
          status: 'COMPLETED',
        } as never);
        return (fn as (client: typeof tx) => Promise<unknown>)(tx);
      });

      await expect(
        service.confirmReception(transferId, supervisorDestAccess),
      ).rejects.toThrow(/estado SHIPPED/);
    });

    it('rechaza supervisor sin acceso al contrato de bodega destino', async () => {
      prisma.$transaction.mockImplementation(async (fn) => {
        tx.inventoryTransfer.findFirst.mockResolvedValue(
          shippedTransfer as never,
        );
        return (fn as (client: typeof tx) => Promise<unknown>)(tx);
      });

      await expect(
        service.confirmReception(transferId, {
          ...supervisorDestAccess,
          allowedContracts: ['otro-contrato'],
        }),
      ).rejects.toThrow(/confirmar recepción/);
    });

    it('aplica CPP ponderado en destino y registra TRANSFER_IN', async () => {
      prisma.$transaction.mockImplementation(async (fn) => {
        tx.inventoryTransfer.findFirst.mockResolvedValue(
          shippedTransfer as never,
        );
        tx.itemStock.findUnique.mockResolvedValue({
          quantity: 6,
          unitCost: 10,
        } as never);
        tx.itemStock.upsert.mockResolvedValue({
          quantity: 10,
          unitCost: 8,
        } as never);
        tx.inventoryTransaction.create.mockResolvedValue({} as never);
        tx.inventoryTransfer.update.mockResolvedValue({} as never);
        tx.inventoryTransfer.findUnique.mockResolvedValue({
          id: transferId,
          status: 'COMPLETED',
        } as never);
        return (fn as (client: typeof tx) => Promise<unknown>)(tx);
      });

      const result = await service.confirmReception(
        transferId,
        supervisorDestAccess,
      );

      expect(result?.status).toBe('COMPLETED');
      expect(tx.itemStock.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            quantity: 10,
            unitCost: 8,
          }),
        }),
      );
      expect(tx.inventoryTransaction.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: TransactionType.TRANSFER_IN,
          quantity: 4,
          previousStock: 6,
          newStock: 10,
          referenceType: 'INVENTORY_TRANSFER',
        }),
      });
      expect(stockService.clearPendingRegularizationFlags).toHaveBeenCalledWith(
        tx,
        destId,
        itemId,
        10,
      );
    });

    it('en bodega destino sin stock previo usa costo de la línea como CPP inicial', async () => {
      prisma.$transaction.mockImplementation(async (fn) => {
        tx.inventoryTransfer.findFirst.mockResolvedValue(
          shippedTransfer as never,
        );
        tx.itemStock.findUnique.mockResolvedValue(null);
        mockGetPolicyThresholds.mockResolvedValue({ minStock: 1, maxStock: 50 });
        tx.itemStock.upsert.mockResolvedValue({} as never);
        tx.inventoryTransaction.create.mockResolvedValue({} as never);
        tx.inventoryTransfer.update.mockResolvedValue({} as never);
        tx.inventoryTransfer.findUnique.mockResolvedValue({
          status: 'COMPLETED',
        } as never);
        return (fn as (client: typeof tx) => Promise<unknown>)(tx);
      });

      await service.confirmReception(transferId, adminUser);

      expect(mockGetPolicyThresholds).toHaveBeenCalledWith(
        tx,
        tenantId,
        itemId,
        destId,
      );
      expect(tx.itemStock.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            quantity: 4,
            unitCost: 5,
            minStock: 1,
            maxStock: 50,
          }),
        }),
      );
    });

    it('invoca clearItemStockPolicy en destino tras recepción', async () => {
      prisma.$transaction.mockImplementation(async (fn) => {
        tx.inventoryTransfer.findFirst.mockResolvedValue(
          shippedTransfer as never,
        );
        tx.itemStock.findUnique.mockResolvedValue({
          quantity: 2,
          unitCost: 8,
        } as never);
        tx.itemStock.upsert.mockResolvedValue({} as never);
        tx.inventoryTransaction.create.mockResolvedValue({} as never);
        tx.inventoryTransfer.update.mockResolvedValue({} as never);
        tx.inventoryTransfer.findUnique.mockResolvedValue({
          status: 'COMPLETED',
        } as never);
        return (fn as (client: typeof tx) => Promise<unknown>)(tx);
      });

      await service.confirmReception(transferId, supervisorDestAccess);

      expect(mockClearItemStockPolicy).toHaveBeenCalledWith(
        tx,
        tenantId,
        itemId,
        destId,
      );
    });
  });

  describe('listTransfers', () => {
    it('pagina y expone lineCount por transferencia (ADMIN)', async () => {
      prisma.inventoryTransfer.findMany.mockResolvedValue([
        {
          id: transferId,
          tenantId,
          status: 'SHIPPED',
          _count: { lines: 3 },
          originWarehouse: {
            id: originId,
            code: 'ORI',
            name: 'Origen',
            contractId: destContractId,
          },
          destinationWarehouse: {
            id: destId,
            code: 'DST',
            name: 'Destino',
            contractId: destContractId,
          },
          createdBy: { id: userId, name: 'Admin', email: 'a@test.com' },
        },
      ] as never);
      prisma.inventoryTransfer.count.mockResolvedValue(1);

      const result = await service.listTransfers(adminUser, {
        page: '1',
        pageSize: '10',
        sort: 'status',
        dir: 'asc',
      });

      expect(result).toEqual({
        data: [expect.objectContaining({ id: transferId, lineCount: 3 })],
        total: 1,
        page: 1,
        pageSize: 10,
      });
      expect(prisma.inventoryTransfer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId },
          orderBy: { status: 'asc' },
        }),
      );
    });

    it('filtra por contratos permitidos para SUPERVISOR', async () => {
      prisma.inventoryTransfer.findMany.mockResolvedValue([] as never);
      prisma.inventoryTransfer.count.mockResolvedValue(0);

      await service.listTransfers(supervisorDestAccess);

      expect(prisma.inventoryTransfer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tenantId,
            OR: [
              { originWarehouse: { contractId: { in: [destContractId] } } },
              { destinationWarehouse: { contractId: { in: [destContractId] } } },
            ],
          },
        }),
      );
    });
  });

  describe('getTransferById', () => {
    const completedTransfer = {
      id: transferId,
      tenantId,
      status: 'COMPLETED',
      originWarehouseId: originId,
      destinationWarehouseId: destId,
      lines: [],
      originWarehouse: {
        id: originId,
        code: 'ORI',
        name: 'Origen',
        contractId: destContractId,
      },
      destinationWarehouse: {
        id: destId,
        code: 'DST',
        name: 'Destino',
        contractId: destContractId,
      },
      createdBy: { id: userId, name: 'Admin', email: 'a@test.com' },
    };

    it('lanza NotFoundException si no hay acceso o no existe', async () => {
      prisma.inventoryTransfer.findFirst.mockResolvedValue(null);

      await expect(
        service.getTransferById(transferId, mechanicUser),
      ).rejects.toThrow(NotFoundException);
    });

    it('adjunta reception cuando la transferencia está COMPLETED', async () => {
      const receivedAt = new Date('2026-05-21T15:00:00.000Z');
      prisma.inventoryTransfer.findFirst.mockResolvedValue(
        completedTransfer as never,
      );
      prisma.inventoryTransaction.findFirst.mockResolvedValue({
        date: receivedAt,
        user: { id: userId, name: 'Receptor', email: 'r@test.com' },
      } as never);

      const result = await service.getTransferById(transferId, adminUser);

      expect(result.reception).toEqual({
        at: receivedAt.toISOString(),
        user: { id: userId, name: 'Receptor', email: 'r@test.com' },
      });
      expect(prisma.inventoryTransaction.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            referenceId: transferId,
            type: TransactionType.TRANSFER_IN,
            warehouseId: destId,
          }),
        }),
      );
    });
  });
});
