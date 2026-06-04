import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import {
  InventoryStockService,
  PerformReturnDto,
  PerformTransactionDto,
} from './inventory-stock.service';
import {
  FIELD_DISPATCH_REFERENCE_TYPE,
  FIELD_RETURN_REFERENCE_TYPE,
} from '../../common/inventory/field-dispatch.constants';
import { generatePhysicalCountSheetPdfBuffer } from './physical-count-sheet-pdf.generator';

const mockGenerateCountPdf = jest.mocked(generatePhysicalCountSheetPdfBuffer);
import { getFieldDispatchOutstandingForItem } from '../../common/inventory/field-dispatch-outstanding';
import {
  getPolicyThresholdsForNewItemStockRow,
  clearItemStockPolicyIfMatchesWarehouse,
} from '../inventory-items/inventory-item-stock-policy.helper';

jest.mock('../inventory-items/inventory-item-stock-policy.helper');
jest.mock('../../common/inventory/field-dispatch-outstanding');
jest.mock('./physical-count-sheet-pdf.generator', () => ({
  generatePhysicalCountSheetPdfBuffer: jest
    .fn()
    .mockResolvedValue(Buffer.from('%PDF-mock')),
}));

const mockGetPolicyThresholds = jest.mocked(
  getPolicyThresholdsForNewItemStockRow,
);
const mockClearItemStockPolicy = jest.mocked(
  clearItemStockPolicyIfMatchesWarehouse,
);
const mockFieldDispatchOutstanding = jest.mocked(
  getFieldDispatchOutstandingForItem,
);

describe('InventoryStockService', () => {
  let service: InventoryStockService;
  let prisma: DeepMockProxy<PrismaService>;
  let tx: DeepMockProxy<Prisma.TransactionClient>;

  const tenantId = '11111111-1111-1111-1111-111111111111';
  const warehouseId = '22222222-2222-2222-2222-222222222222';
  const itemId = '33333333-3333-3333-3333-333333333333';
  const userId = '44444444-4444-4444-4444-444444444444';
  const workOrderId = '55555555-5555-5555-5555-555555555555';

  const contractId = '66666666-6666-6666-6666-666666666666';

  const adminUser = {
    id: userId,
    tenantId,
    role: 'ADMIN',
  };

  const userWithoutCostView = {
    id: userId,
    tenantId,
    role: 'USER',
    permissions: ['inventory:stock:read'],
    allowedContracts: [contractId],
  };

  beforeEach(async () => {
    prisma = mockDeep<PrismaService>();
    tx = mockDeep<Prisma.TransactionClient>();

    mockGetPolicyThresholds.mockResolvedValue({ minStock: 0, maxStock: 0 });
    mockClearItemStockPolicy.mockResolvedValue(undefined);
    mockFieldDispatchOutstanding.mockResolvedValue(10);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventoryStockService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: StorageService,
          useValue: { getReadOnlyUrl: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(InventoryStockService);
    jest.clearAllMocks();
    mockGetPolicyThresholds.mockResolvedValue({ minStock: 0, maxStock: 0 });
    mockClearItemStockPolicy.mockResolvedValue(undefined);
    mockFieldDispatchOutstanding.mockResolvedValue(10);
  });

  function setupWarehouseFound(): void {
    tx.warehouse.findFirst.mockResolvedValue({
      id: warehouseId,
      tenantId,
      contractId,
    } as never);
  }

  function setupExistingStock(
    quantity: number,
    unitCost = 10,
    overrides: Partial<{ minStock: number; maxStock: number }> = {},
  ): void {
    tx.itemStock.findUnique.mockResolvedValue({
      warehouseId,
      itemId,
      quantity,
      unitCost,
      minStock: 0,
      maxStock: 0,
      ...overrides,
    } as never);
  }

  function setupUpsertResult(quantity: number, unitCost: number): void {
    tx.itemStock.upsert.mockResolvedValue({
      warehouseId,
      itemId,
      quantity,
      unitCost,
      minStock: 0,
      maxStock: 0,
    } as never);
  }

  function setupTransactionCreate(): void {
    tx.inventoryTransaction.create.mockResolvedValue({
      id: 'txn-1',
      type: 'IN',
      quantity: 1,
      previousStock: 0,
      newStock: 1,
      isPendingRegularization: false,
    } as never);
    tx.inventoryTransaction.updateMany.mockResolvedValue({ count: 0 });
  }

  describe('clearPendingRegularizationFlags', () => {
    it('no actualiza transacciones si el saldo sigue negativo', async () => {
      await service.clearPendingRegularizationFlags(
        tx,
        warehouseId,
        itemId,
        -5,
      );

      expect(tx.inventoryTransaction.updateMany).not.toHaveBeenCalled();
    });

    it('limpia marcas de regularización pendiente cuando el saldo es ≥ 0', async () => {
      await service.clearPendingRegularizationFlags(tx, warehouseId, itemId, 0);

      expect(tx.inventoryTransaction.updateMany).toHaveBeenCalledWith({
        where: {
          warehouseId,
          itemId,
          isPendingRegularization: true,
        },
        data: { isPendingRegularization: false },
      });
    });
  });

  describe('performTransactionCore', () => {
    const baseDto: PerformTransactionDto = {
      warehouseId,
      itemId,
      type: 'IN',
      quantity: 5,
      unitCost: 20,
    };

    it('rechaza transacción sin identificador de usuario', async () => {
      await expect(
        service.performTransactionCore(tx, baseDto, { tenantId }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rechaza cantidad ≤ 0 en movimientos distintos de ADJUST', async () => {
      await expect(
        service.performTransactionCore(
          tx,
          { ...baseDto, type: 'OUT', quantity: 0 },
          adminUser,
        ),
      ).rejects.toThrow('La cantidad debe ser mayor a cero.');
    });

    it('rechaza bodega inexistente o de otro tenant', async () => {
      tx.warehouse.findFirst.mockResolvedValue(null);

      await expect(
        service.performTransactionCore(tx, baseDto, adminUser),
      ).rejects.toThrow(NotFoundException);
    });

    it('IN incrementa stock y recalcula CPP ponderado', async () => {
      setupWarehouseFound();
      setupExistingStock(10, 10);
      setupUpsertResult(15, 13.3333);
      setupTransactionCreate();

      const result = await service.performTransactionCore(
        tx,
        { ...baseDto, type: 'IN', quantity: 5, unitCost: 20 },
        adminUser,
      );

      expect(tx.itemStock.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ quantity: 15 }),
        }),
      );
      expect(result.stock.quantity).toBe(15);
      expect(result.transaction).toBeDefined();
      expect(tx.inventoryTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'IN',
            quantity: 5,
            previousStock: 10,
            newStock: 15,
            isPendingRegularization: false,
          }),
        }),
      );
    });

    it('OUT descuenta stock y marca regularización pendiente si queda negativo', async () => {
      setupWarehouseFound();
      setupExistingStock(3, 8);
      setupUpsertResult(-2, 8);
      setupTransactionCreate();
      tx.inventoryTransaction.create.mockResolvedValue({
        id: 'txn-out',
        isPendingRegularization: true,
      } as never);

      await service.performTransactionCore(
        tx,
        { ...baseDto, type: 'OUT', quantity: 5 },
        adminUser,
      );

      expect(tx.itemStock.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ quantity: -2 }),
        }),
      );
      expect(tx.inventoryTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'OUT',
            isPendingRegularization: true,
            newStock: -2,
          }),
        }),
      );
    });

    it('OUT rechaza stock insuficiente cuando blockNegativeStock está activo', async () => {
      setupWarehouseFound();
      setupExistingStock(3, 8);
      tx.tenantOperationalConfig.findUnique.mockResolvedValue({
        blockNegativeStock: true,
      } as never);
      tx.inventoryItem.findFirst.mockResolvedValue({
        partNumber: 'FLUID-1',
        inventoryCode: 'IN001',
      } as never);

      await expect(
        service.performTransactionCore(
          tx,
          { ...baseDto, type: 'OUT', quantity: 5 },
          adminUser,
        ),
      ).rejects.toThrow(/Stock insuficiente/);

      expect(tx.itemStock.upsert).not.toHaveBeenCalled();
    });

    it('ADJUST permite cantidad negativa y marca regularización si el saldo queda < 0', async () => {
      setupWarehouseFound();
      setupExistingStock(2, 5);
      setupUpsertResult(-3, 5);
      setupTransactionCreate();

      await service.performTransactionCore(
        tx,
        { ...baseDto, type: 'ADJUST', quantity: -5 },
        adminUser,
      );

      expect(tx.inventoryTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'ADJUST',
            isPendingRegularization: true,
            newStock: -3,
          }),
        }),
      );
    });

    it('FIELD_DISPATCH solo permite salidas OUT', async () => {
      setupWarehouseFound();

      await expect(
        service.performTransactionCore(
          tx,
          {
            ...baseDto,
            type: 'IN',
            referenceType: FIELD_DISPATCH_REFERENCE_TYPE,
          },
          adminUser,
        ),
      ).rejects.toThrow('FIELD_DISPATCH solo aplica a salidas (OUT).');
    });

    it('FIELD_RETURN exige costo unitario mayor a cero', async () => {
      setupWarehouseFound();
      setupExistingStock(0, 12);

      await expect(
        service.performTransactionCore(
          tx,
          {
            warehouseId,
            itemId,
            type: 'IN',
            quantity: 1,
            referenceType: FIELD_RETURN_REFERENCE_TYPE,
          },
          adminUser,
        ),
      ).rejects.toThrow(/costo unitario mayor a cero/);
    });

    it('FIELD_RETURN rechaza cantidad mayor al pendiente en terreno', async () => {
      setupWarehouseFound();
      setupExistingStock(0, 12);
      mockFieldDispatchOutstanding.mockResolvedValue(2);

      await expect(
        service.performTransactionCore(
          tx,
          {
            warehouseId,
            itemId,
            type: 'IN',
            quantity: 5,
            unitCost: 12,
            referenceType: FIELD_RETURN_REFERENCE_TYPE,
          },
          adminUser,
        ),
      ).rejects.toThrow(/supera lo pendiente desde terreno/);
    });

    it('crea fila item_stock con política por defecto cuando no existía posición', async () => {
      setupWarehouseFound();
      tx.itemStock.findUnique.mockResolvedValue(null);
      mockGetPolicyThresholds.mockResolvedValue({ minStock: 2, maxStock: 50 });
      setupUpsertResult(7, 15);
      setupTransactionCreate();

      await service.performTransactionCore(
        tx,
        { ...baseDto, type: 'IN', quantity: 7, unitCost: 15 },
        adminUser,
      );

      expect(mockGetPolicyThresholds).toHaveBeenCalledWith(
        tx,
        tenantId,
        itemId,
        warehouseId,
      );
      expect(tx.itemStock.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            minStock: 2,
            maxStock: 50,
          }),
        }),
      );
    });
  });

  describe('performTransaction', () => {
    it('ejecuta la lógica dentro de $transaction con aislamiento Serializable', async () => {
      setupWarehouseFound();
      setupExistingStock(10, 10);
      setupUpsertResult(12, 10);
      setupTransactionCreate();

      prisma.$transaction.mockImplementation(async (fn, opts) => {
        expect(opts).toEqual(
          expect.objectContaining({
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          }),
        );
        return (fn as (client: typeof tx) => Promise<unknown>)(tx);
      });

      const result = await service.performTransaction(
        {
          warehouseId,
          itemId,
          type: 'IN',
          quantity: 2,
          unitCost: 10,
        },
        adminUser,
      );

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(result.stock.quantity).toBe(12);
    });
  });

  describe('performReturn', () => {
    const returnDto: PerformReturnDto = {
      warehouseId,
      itemId,
      quantity: 2,
      workOrderId,
    };

    it('rechaza cantidad no positiva', async () => {
      await expect(
        service.performReturn({ ...returnDto, quantity: 0 }, adminUser),
      ).rejects.toThrow('La cantidad a devolver debe ser mayor a cero.');
    });

    it('rechaza devolución sin salidas previas en la OT', async () => {
      prisma.$transaction.mockImplementation(async (fn) => {
        tx.inventoryTransaction.findMany.mockResolvedValue([]);
        return (fn as (client: typeof tx) => Promise<unknown>)(tx);
      });

      await expect(service.performReturn(returnDto, adminUser)).rejects.toThrow(
        /No se encontraron salidas/,
      );
    });

    it('rechaza devolución que excede el consumo neto de la OT', async () => {
      prisma.$transaction.mockImplementation(async (fn) => {
        tx.inventoryTransaction.findMany
          .mockResolvedValueOnce([
            { quantity: 5, type: 'WORK_ORDER_ISSUE' },
          ] as never)
          .mockResolvedValueOnce([
            { quantity: 4, type: 'WORK_ORDER_RETURN' },
          ] as never);
        return (fn as (client: typeof tx) => Promise<unknown>)(tx);
      });

      await expect(
        service.performReturn({ ...returnDto, quantity: 2 }, adminUser),
      ).rejects.toThrow(/Devolución excede el consumo original/);
    });

    it('incrementa stock y registra WORK_ORDER_RETURN sin recalcular CPP', async () => {
      prisma.$transaction.mockImplementation(async (fn) => {
        tx.inventoryTransaction.findMany
          .mockResolvedValueOnce([{ quantity: 10, type: 'OUT' }] as never)
          .mockResolvedValueOnce([] as never);
        setupExistingStock(4, 25);
        setupUpsertResult(6, 25);
        tx.inventoryTransaction.create.mockResolvedValue({
          id: 'ret-1',
          type: 'WORK_ORDER_RETURN',
          quantity: 2,
        } as never);
        tx.inventoryTransaction.updateMany.mockResolvedValue({ count: 1 });
        return (fn as (client: typeof tx) => Promise<unknown>)(tx);
      });

      const result = await service.performReturn(returnDto, adminUser);

      expect(result.newStock).toBe(6);
      expect(result.unitCost).toBe(25);
      expect(tx.itemStock.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: { quantity: 6 },
        }),
      );
      expect(tx.inventoryTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'WORK_ORDER_RETURN',
            referenceId: workOrderId,
            referenceType: 'WORK_ORDER',
          }),
        }),
      );
    });

    it('enmascara unitCost sin permiso inventory:stock:view_cost', async () => {
      prisma.$transaction.mockImplementation(async (fn) => {
        tx.inventoryTransaction.findMany
          .mockResolvedValueOnce([{ quantity: 5, type: 'OUT' }] as never)
          .mockResolvedValueOnce([] as never);
        setupExistingStock(1, 99);
        setupUpsertResult(3, 99);
        tx.inventoryTransaction.create.mockResolvedValue({} as never);
        return (fn as (client: typeof tx) => Promise<unknown>)(tx);
      });

      const result = await service.performReturn(
        returnDto,
        userWithoutCostView,
      );
      expect(result.unitCost).toBe(0);
    });

    it('crea fila de stock con política del artículo si no existía saldo', async () => {
      mockGetPolicyThresholds.mockResolvedValue({ minStock: 3, maxStock: 30 });
      prisma.$transaction.mockImplementation(async (fn) => {
        tx.inventoryTransaction.findMany
          .mockResolvedValueOnce([
            { quantity: 4, type: 'WORK_ORDER_ISSUE' },
          ] as never)
          .mockResolvedValueOnce([] as never);
        tx.itemStock.findUnique.mockResolvedValue(null);
        setupUpsertResult(2, 0);
        tx.inventoryTransaction.create.mockResolvedValue({
          id: 'ret-new-row',
          type: 'WORK_ORDER_RETURN',
          quantity: 2,
        } as never);
        return (fn as (client: typeof tx) => Promise<unknown>)(tx);
      });

      await service.performReturn(returnDto, adminUser);

      expect(mockGetPolicyThresholds).toHaveBeenCalledWith(
        tx,
        tenantId,
        itemId,
        warehouseId,
      );
      expect(tx.itemStock.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            minStock: 3,
            maxStock: 30,
            quantity: 2,
          }),
        }),
      );
    });
  });

  describe('updateStockLevels', () => {
    it('rechaza bodega inexistente', async () => {
      prisma.warehouse.findFirst.mockResolvedValue(null);

      await expect(
        service.updateStockLevels(
          warehouseId,
          itemId,
          { minStock: 1 },
          adminUser,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('rechaza payload vacío', async () => {
      prisma.warehouse.findFirst.mockResolvedValue({
        id: warehouseId,
        tenantId,
        contractId,
      } as never);
      prisma.inventoryItem.findFirst.mockResolvedValue({ id: itemId } as never);

      await expect(
        service.updateStockLevels(warehouseId, itemId, {}, adminUser),
      ).rejects.toThrow(/Debe indicar stock mínimo/);
    });

    it('rechaza máximo menor que mínimo', async () => {
      prisma.warehouse.findFirst.mockResolvedValue({
        id: warehouseId,
        tenantId,
        contractId,
      } as never);
      prisma.inventoryItem.findFirst.mockResolvedValue({ id: itemId } as never);
      prisma.$transaction.mockImplementation(async (fn) => {
        tx.itemStock.findUnique.mockResolvedValue({
          quantity: 5,
          unitCost: 1,
          minStock: 10,
          maxStock: 20,
          location: null,
        } as never);
        return (fn as (client: typeof tx) => Promise<unknown>)(tx);
      });

      await expect(
        service.updateStockLevels(
          warehouseId,
          itemId,
          { minStock: 15, maxStock: 10 },
          adminUser,
        ),
      ).rejects.toThrow(/máximo no puede ser menor/);
    });
  });

  describe('getTransactionsByWarehouse — enrichTransactionsTrace', () => {
    const trId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

    it('añade trace de recepción/OC y transferencia en kardex paginado', async () => {
      prisma.warehouse.findFirst.mockResolvedValue({
        id: warehouseId,
        tenantId,
        contractId,
      } as never);
      prisma.inventoryTransaction.findMany.mockResolvedValue([
        {
          type: 'IN',
          referenceId: 'wr-1',
          referenceType: 'PURCHASE_RECEIPT',
          warehouseId,
          quantity: 2,
          date: new Date(),
          item: {
            partNumber: 'P1',
            name: 'Filtro',
            description: 'Filtro aceite',
            unitOfMeasure: { id: 'u1', name: 'UN', abbreviation: 'UN' },
          },
          user: { id: userId, name: 'Compras', email: 'c@test.com' },
        },
        {
          type: 'TRANSFER_IN',
          referenceId: trId,
          referenceType: 'INVENTORY_TRANSFER',
          warehouseId,
          quantity: 1,
          date: new Date(),
          item: {
            partNumber: 'P2',
            name: 'Tornillo',
            description: null,
            unitOfMeasure: { id: 'u1', name: 'UN', abbreviation: 'UN' },
          },
          user: { id: userId, name: 'Logística', email: 'l@test.com' },
        },
      ] as never);
      prisma.inventoryTransaction.count.mockResolvedValue(2);
      prisma.warehouseReceipt.findMany.mockResolvedValue([
        {
          id: 'wr-1',
          correlative: 'GR-50',
          purchaseOrder: { id: 'po-1', correlative: 'OC-77' },
        },
      ] as never);
      prisma.inventoryTransfer.findMany.mockResolvedValue([
        {
          id: trId,
          originWarehouseId: 'wh-ori',
          destinationWarehouseId: warehouseId,
          originWarehouse: { code: 'ORI', name: 'Origen' },
          destinationWarehouse: { code: 'DST', name: 'Destino' },
        },
      ] as never);

      const result = await service.getTransactionsByWarehouse(
        warehouseId,
        adminUser,
        { itemId, page: 1, pageSize: 10 },
      );

      expect(result.data).toHaveLength(2);
      expect(result.data[0].trace?.purchaseOrder).toEqual({
        id: 'po-1',
        correlative: 'OC-77',
      });
      expect(result.data[1].trace?.transfer?.direction).toBe('IN');
      expect(result.data[1].trace?.transfer?.destCode).toBe('DST');
    });

    it('marca saldoPendienteAdjust en ADJUST vinculado a recepción', async () => {
      prisma.warehouse.findFirst.mockResolvedValue({
        id: warehouseId,
        tenantId,
        contractId,
      } as never);
      prisma.inventoryTransaction.findMany.mockResolvedValue([
        {
          type: 'ADJUST',
          referenceId: 'wr-adj',
          referenceType: 'PURCHASE_RECEIPT',
          warehouseId,
          quantity: 1,
          date: new Date(),
          item: {
            partNumber: 'X',
            name: 'Item',
            description: 'Item',
            unitOfMeasure: { id: 'u1', name: 'UN', abbreviation: 'UN' },
          },
          user: { id: userId, name: 'U', email: 'u@test.com' },
        },
      ] as never);
      prisma.inventoryTransaction.count.mockResolvedValue(1);
      prisma.warehouseReceipt.findMany.mockResolvedValue([
        {
          id: 'wr-adj',
          correlative: 'GR-ADJ',
          purchaseOrder: { id: 'po-adj', correlative: 'OC-ADJ' },
        },
      ] as never);

      const result = await service.getTransactionsByWarehouse(
        warehouseId,
        adminUser,
        { itemId },
      );

      expect(result.data[0].trace?.saldoPendienteAdjust).toBe(true);
      expect(result.data[0].trace?.warehouseReceipt?.correlative).toBe(
        'GR-ADJ',
      );
    });
  });

  describe('getSupplyAlerts', () => {
    const alertItemId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

    it('devuelve solo filas con quantity <= minStock y calcula suggestedOrderQty', async () => {
      prisma.itemStock.findMany.mockResolvedValue([
        {
          id: 'stock-1',
          warehouseId,
          itemId: alertItemId,
          quantity: 2,
          minStock: 5,
          maxStock: 20,
          unitCost: 100,
          warehouse: { id: warehouseId, code: 'B1', name: 'Central' },
          item: {
            id: alertItemId,
            partNumber: 'PN-1',
            name: 'Filtro',
            unitOfMeasure: { id: 'u1', name: 'UN', abbreviation: 'UN' },
            itemCategory: {
              id: 'cat',
              name: 'Repuestos',
              parentCategory: null,
            },
          },
        },
        {
          id: 'stock-2',
          warehouseId,
          itemId,
          quantity: 10,
          minStock: 5,
          maxStock: 0,
          unitCost: 50,
          warehouse: { id: warehouseId, code: 'B1', name: 'Central' },
          item: {
            id: itemId,
            partNumber: 'PN-2',
            name: 'Tornillo',
            unitOfMeasure: { id: 'u1', name: 'UN', abbreviation: 'UN' },
            itemCategory: {
              id: 'cat',
              name: 'Repuestos',
              parentCategory: null,
            },
          },
        },
      ] as never);
      prisma.requisitionItem.findMany.mockResolvedValue([] as never);
      prisma.inventoryTransaction.groupBy.mockResolvedValue([
        {
          warehouseId,
          itemId: alertItemId,
          _sum: { quantity: 6 },
        },
      ] as never);

      const result = await service.getSupplyAlerts(adminUser);

      expect(result).toHaveLength(1);
      expect(result[0].consumptionLast90Days).toBe(6);
      expect(result[0].avgMonthlyConsumption).toBe(2);
      expect(result[0].suggestedOrderQty).toBe(5);
      expect(result[0].optimalTarget).toBe(20);
    });

    it('devuelve arreglo vacío sin filas bajo mínimo', async () => {
      prisma.itemStock.findMany.mockResolvedValue([
        {
          id: 'stock-ok',
          warehouseId,
          itemId,
          quantity: 20,
          minStock: 5,
          maxStock: 50,
          unitCost: 10,
          warehouse: { id: warehouseId, code: 'B1', name: 'Central' },
          item: {
            id: itemId,
            partNumber: 'X',
            name: 'Item',
            unitOfMeasure: { id: 'u1', name: 'UN', abbreviation: 'UN' },
            itemCategory: { id: 'c', name: 'Cat', parentCategory: null },
          },
        },
      ] as never);

      const result = await service.getSupplyAlerts(adminUser);

      expect(result).toEqual([]);
      expect(prisma.inventoryTransaction.groupBy).not.toHaveBeenCalled();
    });
  });

  describe('getInventoryRecordAccuracy', () => {
    it('calcula IRA% con ajustes de conteo y stock total', async () => {
      prisma.inventoryTransaction.findMany.mockResolvedValue([
        { quantity: -2 },
        { quantity: 3 },
      ] as never);
      prisma.itemStock.aggregate.mockResolvedValue({
        _sum: { quantity: 100 },
      } as never);

      const result = await service.getInventoryRecordAccuracy(adminUser);

      expect(result.periodDays).toBe(30);
      expect(result.numerator).toBe(5);
      expect(result.denominator).toBe(100);
      expect(result.iraPercent).toBe(95);
    });

    it('devuelve iraPercent null sin stock en alcance', async () => {
      prisma.inventoryTransaction.findMany.mockResolvedValue([] as never);
      prisma.itemStock.aggregate.mockResolvedValue({
        _sum: { quantity: 0 },
      } as never);

      const result = await service.getInventoryRecordAccuracy(adminUser);

      expect(result.iraPercent).toBeNull();
      expect(result.note).toContain('Sin stock');
    });

    it('limita IRA% entre 0 y 100 cuando el numerador supera el stock', async () => {
      prisma.inventoryTransaction.findMany.mockResolvedValue([
        { quantity: 50 },
        { quantity: 60 },
      ] as never);
      prisma.itemStock.aggregate.mockResolvedValue({
        _sum: { quantity: 100 },
      } as never);

      const result = await service.getInventoryRecordAccuracy(adminUser);

      expect(result.iraPercent).toBe(0);
    });

    it('aplica filtro warehouseId en ajustes y agregado', async () => {
      prisma.warehouse.findFirst.mockResolvedValue({
        id: warehouseId,
        tenantId,
        contractId,
      } as never);
      prisma.inventoryTransaction.findMany.mockResolvedValue([] as never);
      prisma.itemStock.aggregate.mockResolvedValue({
        _sum: { quantity: 50 },
      } as never);

      await service.getInventoryRecordAccuracy(adminUser, { warehouseId });

      expect(prisma.inventoryTransaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ warehouseId }),
        }),
      );
      expect(prisma.itemStock.aggregate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ warehouseId }),
        }),
      );
    });
  });

  describe('getStockByWarehouse', () => {
    const stockItemId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

    const stockRow = {
      id: 'stock-row-1',
      warehouseId,
      itemId: stockItemId,
      quantity: 20,
      unitCost: 500,
      location: 'A-01',
      item: {
        id: stockItemId,
        partNumber: 'PN-9',
        name: 'Rodamiento',
        description: 'Rodamiento axial',
        itemCategory: {
          id: 'cat-1',
          name: 'Repuestos',
          parentCategoryId: null,
          parentCategory: null,
        },
        unitOfMeasure: { id: 'u1', name: 'UN', abbreviation: 'UN' },
      },
    };

    function setupWarehouseAndStock(): void {
      prisma.warehouse.findFirst.mockResolvedValue({
        id: warehouseId,
        tenantId,
        contractId,
      } as never);
      prisma.inventoryTransaction.groupBy
        .mockResolvedValueOnce([
          { itemId: stockItemId, _sum: { quantity: 10 } },
        ] as never)
        .mockResolvedValueOnce([
          { itemId: stockItemId, _sum: { quantity: 3 } },
        ] as never);
      prisma.itemStock.findMany.mockResolvedValue([stockRow] as never);
      prisma.stockReservation.groupBy.mockResolvedValue([
        { itemId: stockItemId, _sum: { quantity: 5 } },
      ] as never);
      prisma.requisitionItem.findMany.mockResolvedValue([] as never);
    }

    it('lanza NotFoundException si la bodega no existe', async () => {
      prisma.warehouse.findFirst.mockResolvedValue(null);

      await expect(
        service.getStockByWarehouse(warehouseId, adminUser),
      ).rejects.toThrow(NotFoundException);
    });

    it('calcula disponible, reservado y pendiente en terreno', async () => {
      setupWarehouseAndStock();

      const rows = await service.getStockByWarehouse(warehouseId, adminUser);

      expect(rows).toHaveLength(1);
      expect(rows[0].reservedQuantity).toBe(5);
      expect(rows[0].availableQuantity).toBe(15);
      expect(rows[0].fieldDispatchOutstandingQty).toBe(7);
      expect(rows[0].unitCost).toBe(500);
    });

    it('enmascara unitCost sin permiso inventory:stock:view_cost', async () => {
      setupWarehouseAndStock();

      const rows = await service.getStockByWarehouse(
        warehouseId,
        userWithoutCostView,
      );

      expect(rows[0].unitCost).toBe(0);
    });

    it('filtra por ubicación parcial (ILIKE)', async () => {
      setupWarehouseAndStock();

      await service.getStockByWarehouse(warehouseId, adminUser, {
        location: 'a-01',
      });

      expect(prisma.itemStock.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            location: { contains: 'a-01', mode: 'insensitive' },
          }),
        }),
      );
    });
  });

  describe('regularización pendiente', () => {
    it('getPendingRegularizations lista transacciones marcadas', async () => {
      prisma.inventoryTransaction.findMany.mockResolvedValue([
        {
          id: 'tx-pend',
          isPendingRegularization: true,
          item: {
            partNumber: 'P1',
            name: 'Item',
            description: 'Desc',
            unitOfMeasure: { id: 'u1', name: 'UN', abbreviation: 'UN' },
          },
          warehouse: { code: 'B1', name: 'Central' },
          user: { name: 'Operador' },
        },
      ] as never);

      const rows = await service.getPendingRegularizations(adminUser);

      expect(rows).toHaveLength(1);
      expect(prisma.inventoryTransaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            isPendingRegularization: true,
          }),
        }),
      );
    });

    it('getPendingCount usa query agregada por tenant', async () => {
      prisma.$queryRaw.mockResolvedValue([{ c: 7 }] as never);

      const count = await service.getPendingCount(adminUser);

      expect(count).toBe(7);
    });

    it('getPendingRegularizationPage pagina deuda y enmascara valor sin view_cost', async () => {
      prisma.warehouse.findFirst.mockResolvedValue({
        id: warehouseId,
        tenantId,
        contractId,
        code: 'B1',
        name: 'Central',
      } as never);
      prisma.itemStock.findMany.mockResolvedValue([
        {
          id: 'stock-debt',
          quantity: -2,
          unitCost: 100,
          location: 'R-1',
          bin: null,
          item: {
            partNumber: 'PN',
            name: 'Pieza',
            description: 'Pieza',
            unitOfMeasure: { id: 'u1', name: 'UN', abbreviation: 'UN' },
            itemCategory: {
              id: 'c',
              name: 'Cat',
              parentCategory: null,
            },
          },
        },
      ] as never);
      prisma.itemStock.count.mockResolvedValue(1);
      prisma.warehouseReceipt.count.mockResolvedValue(0);

      const result = await service.getPendingRegularizationPage(
        warehouseId,
        userWithoutCostView,
        { page: 1, pageSize: 10 },
      );

      expect(result.total).toBe(1);
      expect(result.data[0].physicalShortageQty).toBe(2);
      expect(result.data[0].debtValue).toBe(0);
      expect(result.data[0].unitCost).toBe(0);
    });
  });

  describe('buildPhysicalCountSheetPdf', () => {
    it('rechaza bodega inexistente', async () => {
      prisma.warehouse.findFirst.mockResolvedValue(null);

      await expect(
        service.buildPhysicalCountSheetPdf(adminUser, warehouseId),
      ).rejects.toThrow(/Bodega no encontrada/);
      expect(mockGenerateCountPdf).not.toHaveBeenCalled();
    });

    it('genera PDF con nombre derivado del código de bodega', async () => {
      prisma.warehouse.findFirst.mockResolvedValue({
        id: warehouseId,
        tenantId,
        contractId,
        code: 'B-CENTRAL',
        name: 'Bodega Central',
      } as never);
      prisma.itemStock.findMany.mockResolvedValue([
        {
          location: 'R1',
          item: {
            inventoryCode: 'IN0001',
            partNumber: 'P1',
            name: 'Filtro',
            description: 'Filtro aceite',
          },
        },
      ] as never);

      const result = await service.buildPhysicalCountSheetPdf(
        adminUser,
        warehouseId,
      );

      expect(mockGenerateCountPdf).toHaveBeenCalledWith(
        expect.objectContaining({
          warehouseCode: 'B-CENTRAL',
          rows: expect.arrayContaining([
            expect.objectContaining({
              inventoryCode: 'IN0001',
              itemName: 'Filtro',
              description: 'Filtro aceite',
            }),
          ]),
        }),
        expect.any(Object),
      );
      expect(result.filename).toBe('B-CENTRAL-conteo-fisico.pdf');
      expect(result.buffer).toBeInstanceOf(Buffer);
    });
  });

  describe('getStockPosition', () => {
    it('devuelve ubicación y cantidad cuando existe posición', async () => {
      prisma.warehouse.findFirst.mockResolvedValue({
        id: warehouseId,
        tenantId,
        contractId,
      } as never);
      prisma.inventoryItem.findFirst.mockResolvedValue({ id: itemId } as never);
      prisma.itemStock.findUnique.mockResolvedValue({
        location: '  A-01  ',
        quantity: 42,
      } as never);

      const pos = await service.getStockPosition(
        warehouseId,
        itemId,
        adminUser,
      );

      expect(pos).toEqual({ location: 'A-01', quantityOnHand: 42 });
    });

    it('devuelve quantityOnHand 0 si no hay fila item_stock', async () => {
      prisma.warehouse.findFirst.mockResolvedValue({
        id: warehouseId,
        tenantId,
        contractId,
      } as never);
      prisma.inventoryItem.findFirst.mockResolvedValue({ id: itemId } as never);
      prisma.itemStock.findUnique.mockResolvedValue(null);

      const pos = await service.getStockPosition(
        warehouseId,
        itemId,
        adminUser,
      );

      expect(pos).toEqual({ location: null, quantityOnHand: 0 });
    });
  });
});
