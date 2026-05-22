import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SequenceService } from '../../common/sequence/sequence.service';
import { AuditService } from '../../common/audit/audit.service';
import { InventoryStockService } from '../inventory-stock/inventory-stock.service';
import { WarehouseReceiptsService } from './warehouse-receipts.service';
import { assertUserHasContractAccess } from './purchase-contract-access.util';
import {
  getPolicyThresholdsForNewItemStockRow,
  clearItemStockPolicyIfMatchesWarehouse,
} from '../inventory-items/inventory-item-stock-policy.helper';

jest.mock('./purchase-contract-access.util', () => {
  const actual = jest.requireActual<typeof import('./purchase-contract-access.util')>(
    './purchase-contract-access.util',
  );
  return {
    ...actual,
    assertUserHasContractAccess: jest.fn(),
  };
});
jest.mock('./purchase-requisition-auto-close.util', () => ({
  requisitionIdFromPurchaseOrder: jest.fn().mockReturnValue(null),
  tryAutoCloseRequisitionIfFullyReconciled: jest.fn(),
}));
jest.mock('../inventory-items/inventory-item-stock-policy.helper');

const mockAssertContractAccess = jest.mocked(assertUserHasContractAccess);
const mockGetPolicyThresholds = jest.mocked(getPolicyThresholdsForNewItemStockRow);
const mockClearItemStockPolicy = jest.mocked(
  clearItemStockPolicyIfMatchesWarehouse,
);

describe('WarehouseReceiptsService', () => {
  let service: WarehouseReceiptsService;
  let prisma: DeepMockProxy<PrismaService>;
  let tx: DeepMockProxy<Prisma.TransactionClient>;
  let stockService: DeepMockProxy<InventoryStockService>;
  let sequenceService: DeepMockProxy<SequenceService>;
  let auditLog: jest.Mock;

  const tenantId = '11111111-1111-1111-1111-111111111111';
  const receiptId = '22222222-2222-2222-2222-222222222222';
  const poId = '33333333-3333-3333-3333-333333333333';
  const warehouseId = '44444444-4444-4444-4444-444444444444';
  const itemId = '55555555-5555-5555-5555-555555555555';
  const contractId = '66666666-6666-6666-6666-666666666666';
  const userId = '77777777-7777-7777-7777-777777777777';

  const user = { id: userId, tenantId, role: 'ADMIN' };

  function buildReceipt(overrides: Partial<{ status: string; quantityConfirmed: number }> = {}) {
    return {
      id: receiptId,
      warehouseId,
      purchaseOrderId: poId,
      status: overrides.status ?? 'PARTIAL',
      correlative: 'GR-001',
      observations: null,
      purchaseOrder: {
        id: poId,
        status: 'SENT',
        correlative: 'OC-900',
        equipmentId: null,
        contract: { id: contractId, code: 'C1', name: 'Contrato' },
      },
      items: [
        {
          id: 'ri-1',
          orderItemId: 'oi-1',
          quantityReceived: 4,
          quantityConfirmed: overrides.quantityConfirmed ?? 0,
          observations: null,
          quantityPendingOnPurchase: 6,
          orderItem: {
            quantity: 10,
            unitCost: 250,
            inventoryItemId: itemId,
            inventoryItem: { isInventory: true },
          },
        },
      ],
    };
  }

  beforeEach(async () => {
    prisma = mockDeep<PrismaService>();
    tx = mockDeep<Prisma.TransactionClient>();
    stockService = mockDeep<InventoryStockService>();
    sequenceService = mockDeep<SequenceService>();
    auditLog = jest.fn().mockResolvedValue(undefined);
    mockAssertContractAccess.mockImplementation(() => undefined);
    mockGetPolicyThresholds.mockResolvedValue({ minStock: 0, maxStock: 0 });
    mockClearItemStockPolicy.mockResolvedValue(undefined);
    stockService.clearPendingRegularizationFlags.mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WarehouseReceiptsService,
        { provide: PrismaService, useValue: prisma },
        { provide: SequenceService, useValue: sequenceService },
        { provide: AuditService, useValue: { log: auditLog } },
        { provide: InventoryStockService, useValue: stockService },
      ],
    }).compile();

    service = module.get(WarehouseReceiptsService);
  });

  describe('confirm', () => {
  it('rechaza confirmación sin delta nuevo (quantityConfirmed ya cubre recibido)', async () => {
    jest
      .spyOn(service, 'findById')
      .mockResolvedValue(buildReceipt({ quantityConfirmed: 4 }) as never);

    await expect(service.confirm(receiptId, user)).rejects.toThrow(
      /No hay cantidades nuevas para confirmar/,
    );
  });

  it('rechaza guía ya COMPLETED', async () => {
    jest
      .spyOn(service, 'findById')
      .mockResolvedValue(buildReceipt({ status: 'COMPLETED' }) as never);

    await expect(service.confirm(receiptId, user)).rejects.toThrow(
      /completamente confirmada/,
    );
  });

  it('confirma delta a stock con PURCHASE_RECEIPT y CPP en bodega', async () => {
    const before = buildReceipt({ quantityConfirmed: 1 });
    const after = buildReceipt({ status: 'PARTIAL', quantityConfirmed: 4 });

    jest
      .spyOn(service, 'findById')
      .mockResolvedValueOnce(before as never)
      .mockResolvedValueOnce(after as never);

    prisma.$transaction.mockImplementation(async (fn, opts) => {
      expect(opts).toEqual(
        expect.objectContaining({
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        }),
      );
      tx.warehouse.findFirst.mockResolvedValue({
        id: warehouseId,
        tenantId,
        isActive: true,
      } as never);
      tx.receiptItem.groupBy.mockResolvedValue([] as never);
      tx.receiptItem.update.mockResolvedValue({} as never);
      tx.itemStock.findUnique.mockResolvedValue({
        quantity: 6,
        unitCost: 200,
      } as never);
      tx.itemStock.upsert.mockResolvedValue({} as never);
      tx.inventoryTransaction.create.mockResolvedValue({} as never);
      tx.warehouseReceipt.update.mockResolvedValue({} as never);
      tx.purchaseOrder.update.mockResolvedValue({} as never);
      return (fn as (client: typeof tx) => Promise<unknown>)(tx);
    });

    await service.confirm(receiptId, user);

    expect(tx.receiptItem.update).toHaveBeenCalledWith({
      where: { id: 'ri-1' },
      data: { quantityConfirmed: 4 },
    });
    expect(tx.itemStock.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          quantity: { increment: 3 },
        }),
      }),
    );
    expect(tx.inventoryTransaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'PURCHASE_RECEIPT',
        quantity: 3,
        previousStock: 6,
        newStock: 9,
        referenceId: receiptId,
      }),
    });
    expect(stockService.clearPendingRegularizationFlags).toHaveBeenCalled();
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'WAREHOUSE_RECEIPT',
        newValue: expect.objectContaining({
          event: 'warehouse_receipt_partial',
        }),
      }),
    );
  });

  it('marca recepción y OC como completadas cuando se cubre la orden', async () => {
    const receipt = buildReceipt({ quantityConfirmed: 0 });
    receipt.items[0].quantityReceived = 10;

    jest
      .spyOn(service, 'findById')
      .mockResolvedValueOnce(receipt as never)
      .mockResolvedValueOnce({ ...receipt, status: 'COMPLETED' } as never);

    prisma.$transaction.mockImplementation(async (fn) => {
      tx.warehouse.findFirst.mockResolvedValue({ id: warehouseId } as never);
      tx.receiptItem.groupBy.mockResolvedValue([] as never);
      tx.receiptItem.update.mockResolvedValue({} as never);
      tx.itemStock.findUnique.mockResolvedValue(null);
      tx.itemStock.upsert.mockResolvedValue({} as never);
      tx.inventoryTransaction.create.mockResolvedValue({} as never);
      tx.warehouseReceipt.update.mockResolvedValue({} as never);
      tx.purchaseOrder.update.mockResolvedValue({} as never);
      return (fn as (client: typeof tx) => Promise<unknown>)(tx);
    });

    await service.confirm(receiptId, user);

    expect(tx.warehouseReceipt.update).toHaveBeenCalledWith({
      where: { id: receiptId },
      data: expect.objectContaining({ status: 'COMPLETED' }),
    });
    expect(tx.purchaseOrder.update).toHaveBeenCalledWith({
      where: { id: poId },
      data: { status: 'RECEIVED' },
    });
  });
  });

  describe('updateItems', () => {
    it('rechaza modificar guía COMPLETED', async () => {
      jest
        .spyOn(service, 'findById')
        .mockResolvedValue(buildReceipt({ status: 'COMPLETED' }) as never);

      await expect(
        service.updateItems(
          receiptId,
          [{ id: 'ri-1', quantityReceived: 1 }],
          user,
        ),
      ).rejects.toThrow(/completamente confirmada/);
    });

    it('rechaza cantidad por debajo de lo ya confirmado', async () => {
      jest
        .spyOn(service, 'findById')
        .mockResolvedValue(buildReceipt({ quantityConfirmed: 3 }) as never);

      prisma.$transaction.mockImplementation(async (fn) => {
        tx.receiptItem.findMany.mockResolvedValue([
          {
            id: 'ri-1',
            orderItemId: 'oi-1',
            quantityConfirmed: 3,
            orderItem: { quantity: 10 },
          },
        ] as never);
        return (fn as (client: typeof tx) => Promise<unknown>)(tx);
      });

      await expect(
        service.updateItems(
          receiptId,
          [{ id: 'ri-1', quantityReceived: 1 }],
          user,
        ),
      ).rejects.toThrow(/ya confirmado/);
    });

    it('rechaza sobre-recepción respecto al pendiente de la OC', async () => {
      jest.spyOn(service, 'findById').mockResolvedValue(buildReceipt() as never);

      prisma.$transaction.mockImplementation(async (fn) => {
        tx.receiptItem.findMany.mockResolvedValue([
          {
            id: 'ri-1',
            orderItemId: 'oi-1',
            quantityConfirmed: 0,
            orderItem: { quantity: 10 },
          },
        ] as never);
        tx.receiptItem.groupBy.mockResolvedValue([
          { orderItemId: 'oi-1', _sum: { quantityReceived: 8 } },
        ] as never);
        return (fn as (client: typeof tx) => Promise<unknown>)(tx);
      });

      await expect(
        service.updateItems(
          receiptId,
          [{ id: 'ri-1', quantityReceived: 5 }],
          user,
        ),
      ).rejects.toThrow(/cantidad pendiente/);
    });

    it('persiste cantidades y audita receipt_progress_saved', async () => {
      jest.spyOn(service, 'findById').mockResolvedValue(buildReceipt() as never);

      prisma.$transaction.mockImplementation(async (fn) => {
        tx.receiptItem.findMany.mockResolvedValue([
          {
            id: 'ri-1',
            orderItemId: 'oi-1',
            quantityConfirmed: 0,
            orderItem: { quantity: 10 },
          },
        ] as never);
        tx.receiptItem.groupBy.mockResolvedValue([] as never);
        tx.receiptItem.update.mockResolvedValue({} as never);
        return (fn as (client: typeof tx) => Promise<unknown>)(tx);
      });

      await service.updateItems(
        receiptId,
        [{ id: 'ri-1', quantityReceived: 4, observations: 'OK' }],
        user,
      );

      expect(tx.receiptItem.update).toHaveBeenCalledWith({
        where: { id: 'ri-1' },
        data: { quantityReceived: 4, observations: 'OK' },
      });
      expect(auditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          newValue: expect.objectContaining({ event: 'receipt_progress_saved' }),
        }),
      );
    });
  });

  describe('findAll', () => {
    it('lista por tenant sin filtro de contrato (ADMIN)', async () => {
      prisma.warehouseReceipt.count.mockResolvedValue(2);
      prisma.warehouseReceipt.findMany.mockResolvedValue([
        { id: receiptId, correlative: 'GR-001' },
      ] as never);

      const result = await service.findAll(tenantId, { role: 'ADMIN' });

      expect(result.total).toBe(2);
      expect(prisma.warehouseReceipt.count).toHaveBeenCalledWith({
        where: { tenantId },
      });
    });

    it('restringe por allowedContracts para USER', async () => {
      prisma.warehouseReceipt.count.mockResolvedValue(0);
      prisma.warehouseReceipt.findMany.mockResolvedValue([] as never);

      await service.findAll(tenantId, {
        role: 'USER',
        allowedContracts: [contractId],
      });

      expect(prisma.warehouseReceipt.count).toHaveBeenCalledWith({
        where: {
          AND: [
            { tenantId },
            { purchaseOrder: { contractId: { in: [contractId] } } },
          ],
        },
      });
    });

    it('aplica búsqueda por correlative en el where', async () => {
      prisma.warehouseReceipt.count.mockResolvedValue(1);
      prisma.warehouseReceipt.findMany.mockResolvedValue([] as never);

      await service.findAll(tenantId, { role: 'ADMIN' }, { search: 'GR-900' });

      expect(prisma.warehouseReceipt.count).toHaveBeenCalledWith({
        where: {
          AND: [
            { tenantId },
            {
              OR: expect.arrayContaining([
                expect.objectContaining({
                  correlative: expect.objectContaining({
                    contains: 'GR-900',
                  }),
                }),
              ]),
            },
          ],
        },
      });
    });
  });

  describe('create', () => {
    const newReceiptId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

    it('rechaza si ya existe recepción PENDING en la misma OC', async () => {
      prisma.$transaction.mockImplementation(async (fn) => {
        tx.purchaseOrder.findFirst.mockResolvedValue({
          id: poId,
          tenantId,
          contractId,
          status: 'SENT',
          items: [{ id: 'oi-1', quantity: 10 }],
        } as never);
        tx.warehouseReceipt.findFirst.mockResolvedValue({
          correlative: 'GR-BORRADOR',
        } as never);
        return (fn as (client: typeof tx) => Promise<unknown>)(tx);
      });

      await expect(
        service.create({ purchaseOrderId: poId, warehouseId }, user),
      ).rejects.toThrow(/recepción en borrador abierta/);
    });

    it('rechaza bodega de otro contrato que la OC', async () => {
      prisma.$transaction.mockImplementation(async (fn) => {
        tx.purchaseOrder.findFirst.mockResolvedValue({
          id: poId,
          tenantId,
          contractId,
          status: 'SENT',
          items: [{ id: 'oi-1', quantity: 10 }],
        } as never);
        tx.warehouseReceipt.findFirst.mockResolvedValue(null);
        tx.warehouse.findFirst.mockResolvedValue({
          id: warehouseId,
          tenantId,
          contractId: 'otro-contrato',
        } as never);
        return (fn as (client: typeof tx) => Promise<unknown>)(tx);
      });

      await expect(
        service.create({ purchaseOrderId: poId, warehouseId }, user),
      ).rejects.toThrow(/mismo contrato/);
    });

    it('crea guía con quantityExpected según recepciones previas', async () => {
      sequenceService.getNextCorrelative.mockResolvedValue('GR-010');

      prisma.$transaction.mockImplementation(async (fn) => {
        tx.purchaseOrder.findFirst.mockResolvedValue({
          id: poId,
          tenantId,
          contractId,
          status: 'SENT',
          items: [{ id: 'oi-1', quantity: 10 }],
        } as never);
        tx.warehouseReceipt.findFirst.mockResolvedValue(null);
        tx.warehouse.findFirst.mockResolvedValue({
          id: warehouseId,
          tenantId,
          contractId,
        } as never);
        tx.receiptItem.groupBy.mockResolvedValue([
          { orderItemId: 'oi-1', _sum: { quantityReceived: 4 } },
        ] as never);
        tx.warehouseReceipt.create.mockResolvedValue({
          id: newReceiptId,
          correlative: 'GR-010',
          warehouse: { code: 'B1', name: 'Bodega' },
          items: [],
        } as never);
        return (fn as (client: typeof tx) => Promise<unknown>)(tx);
      });

      const result = await service.create(
        { purchaseOrderId: poId, warehouseId },
        user,
      );

      expect(result.correlative).toBe('GR-010');
      expect(tx.warehouseReceipt.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            correlative: 'GR-010',
            items: {
              create: [
                expect.objectContaining({
                  orderItemId: 'oi-1',
                  quantityExpected: 6,
                  quantityReceived: 0,
                }),
              ],
            },
          }),
        }),
      );
      expect(auditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          newValue: expect.objectContaining({
            event: 'warehouse_receipt_created',
          }),
        }),
      );
    });
  });
});
