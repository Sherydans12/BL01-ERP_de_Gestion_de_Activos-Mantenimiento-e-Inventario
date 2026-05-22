import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryStockService } from '../inventory-stock/inventory-stock.service';
import {
  CreateInventoryAdjustmentDto,
  InventoryAdjustmentService,
} from './inventory-adjustment.service';

describe('InventoryAdjustmentService', () => {
  let service: InventoryAdjustmentService;
  let prisma: DeepMockProxy<PrismaService>;
  let tx: DeepMockProxy<Prisma.TransactionClient>;
  let stockService: DeepMockProxy<InventoryStockService>;

  const tenantId = '11111111-1111-1111-1111-111111111111';
  const warehouseId = '22222222-2222-2222-2222-222222222222';
  const itemId = '33333333-3333-3333-3333-333333333333';
  const poId = '44444444-4444-4444-4444-444444444444';
  const receiptId = '55555555-5555-5555-5555-555555555555';
  const userId = '66666666-6666-6666-6666-666666666666';

  const adminUser = {
    id: userId,
    tenantId,
    role: 'ADMIN',
  };

  const mechanicUser = {
    id: userId,
    tenantId,
    role: 'MECHANIC',
  };

  const longComment =
    'Explicación detallada del ajuste por conteo físico en bodega.';

  function baseDto(
    overrides: Partial<CreateInventoryAdjustmentDto> = {},
  ): CreateInventoryAdjustmentDto {
    return {
      warehouseId,
      itemId,
      newPhysicalQuantity: 8,
      reason: 'CONTEO',
      comment: longComment,
      ...overrides,
    };
  }

  function setupWarehouseAndItem(
    currentQty = 10,
    unitCost = 12,
  ): void {
    prisma.warehouse.findFirst.mockResolvedValue({ id: warehouseId } as never);
    prisma.inventoryItem.findFirst.mockResolvedValue({ id: itemId } as never);
    prisma.itemStock.findUnique.mockResolvedValue({
      quantity: currentQty,
      unitCost,
    } as never);
  }

  beforeEach(async () => {
    prisma = mockDeep<PrismaService>();
    tx = mockDeep<Prisma.TransactionClient>();
    stockService = mockDeep<InventoryStockService>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventoryAdjustmentService,
        { provide: PrismaService, useValue: prisma },
        { provide: InventoryStockService, useValue: stockService },
      ],
    }).compile();

    service = module.get(InventoryAdjustmentService);
    jest.clearAllMocks();
  });

  describe('create — validaciones comunes', () => {
    it('rechaza rol sin privilegio', async () => {
      await expect(
        service.create(baseDto(), mechanicUser),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rechaza comentario vacío', async () => {
      await expect(
        service.create(baseDto({ comment: '  ' }), adminUser),
      ).rejects.toThrow(/comentario del ajuste es obligatorio/);
    });

    it('rechaza comentario corto en MERMAS/DANO', async () => {
      await expect(
        service.create(
          baseDto({ reason: 'MERMAS', comment: 'corto' }),
          adminUser,
        ),
      ).rejects.toThrow(/explicación detallada/);
    });

    it('rechaza SALDO_PENDIENTE sin OC ni recepción', async () => {
      await expect(
        service.create(
          baseDto({ reason: 'SALDO_PENDIENTE', newPhysicalQuantity: 15 }),
          adminUser,
        ),
      ).rejects.toThrow(/Orden de Compra y la Recepción son obligatorias/);
    });

    it('rechaza cuando no hay delta respecto al stock actual', async () => {
      setupWarehouseAndItem(10);
      await expect(
        service.create(baseDto({ newPhysicalQuantity: 10 }), adminUser),
      ).rejects.toThrow(/No hay diferencia/);
    });

    it('rechaza bodega inexistente', async () => {
      prisma.warehouse.findFirst.mockResolvedValue(null);
      await expect(service.create(baseDto(), adminUser)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('create — CONTEO (ajuste físico simple)', () => {
    it('delega en performTransaction con delta negativo', async () => {
      setupWarehouseAndItem(10, 12);
      stockService.performTransaction.mockResolvedValue({
        stock: { quantity: 8 },
        transaction: { id: 'adj-1' },
      } as never);

      const result = await service.create(
        baseDto({ newPhysicalQuantity: 8, reason: 'CONTEO' }),
        adminUser,
      );

      expect(stockService.performTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'ADJUST',
          quantity: -2,
          referenceType: 'INVENTORY_ADJUSTMENT',
          notes: expect.stringContaining('Error de conteo'),
        }),
        adminUser,
      );
      expect(stockService.performTransactionCore).not.toHaveBeenCalled();
      expect(result.transaction.id).toBe('adj-1');
    });
  });

  describe('create — SALDO_PENDIENTE', () => {
    const saldoDto = (): CreateInventoryAdjustmentDto =>
      baseDto({
        reason: 'SALDO_PENDIENTE',
        newPhysicalQuantity: 8,
        purchaseOrderId: poId,
        purchaseReceiptId: receiptId,
        comment: 'Cierre de diferencia pendiente en guía de compras.',
      });

    function setupSaldoPendientePrereqs(
      receiptStatus: string,
      receiptLines: Array<{
        quantityExpected: number;
        quantityReceived: number;
      }>,
    ): void {
      setupWarehouseAndItem(5, 10);
      prisma.warehouseReceipt.findFirst.mockResolvedValue({
        id: receiptId,
        purchaseOrderId: poId,
        warehouseId,
        status: receiptStatus,
      } as never);
      prisma.receiptItem.findMany.mockResolvedValue(
        receiptLines.map((l, i) => ({
          id: `line-${i}`,
          quantityExpected: l.quantityExpected,
          quantityReceived: l.quantityReceived,
        })) as never,
      );
      prisma.purchaseOrder.findFirst.mockResolvedValue({
        id: poId,
        correlative: 'OC-2026-001',
      } as never);
    }

    it('rechaza guía en estado PENDING', async () => {
      setupSaldoPendientePrereqs('PENDING', [
        { quantityExpected: 10, quantityReceived: 5 },
      ]);

      await expect(service.create(saldoDto(), adminUser)).rejects.toThrow(
        /debe estar confirmada/,
      );
    });

    it('rechaza recepción de otra bodega', async () => {
      setupWarehouseAndItem(5);
      prisma.warehouseReceipt.findFirst.mockResolvedValue({
        id: receiptId,
        purchaseOrderId: poId,
        warehouseId: 'otra-bodega',
        status: 'PARTIAL',
      } as never);

      await expect(service.create(saldoDto(), adminUser)).rejects.toThrow(
        /otra bodega/,
      );
    });

    it('rechaza incremento mayor al pendiente en la guía', async () => {
      setupSaldoPendientePrereqs('PARTIAL', [
        { quantityExpected: 10, quantityReceived: 9 },
      ]);

      await expect(service.create(saldoDto(), adminUser)).rejects.toThrow(
        /no tiene pendiente suficiente/,
      );
    });

    it('ejecuta ADJUST + sync recepción/OC en una sola transacción', async () => {
      setupSaldoPendientePrereqs('PARTIAL', [
        { quantityExpected: 10, quantityReceived: 5 },
      ]);

      stockService.performTransactionCore.mockResolvedValue({
        stock: { quantity: 8 },
        transaction: { id: 'txn-saldo' },
      } as never);

      prisma.$transaction.mockImplementation(async (fn, opts) => {
        expect(opts).toEqual(
          expect.objectContaining({
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          }),
        );

        tx.receiptItem.findMany
          .mockResolvedValueOnce([
            {
              id: 'line-1',
              quantityExpected: 10,
              quantityReceived: 5,
            },
          ] as never)
          .mockResolvedValueOnce([
            {
              quantityExpected: 10,
              quantityReceived: 5,
            },
          ] as never);
        tx.receiptItem.update.mockResolvedValue({} as never);
        tx.warehouseReceipt.update.mockResolvedValue({} as never);
        tx.purchaseOrder.findFirst.mockResolvedValue({
          id: poId,
          status: 'SENT',
          items: [{ id: 'oi-1', quantity: 10 }],
        } as never);
        tx.receiptItem.groupBy.mockResolvedValue([
          { orderItemId: 'oi-1', _sum: { quantityReceived: 8 } },
        ] as never);
        tx.purchaseOrder.update.mockResolvedValue({} as never);

        return (fn as (client: typeof tx) => Promise<unknown>)(tx);
      });

      const result = await service.create(saldoDto(), adminUser);

      expect(stockService.performTransactionCore).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          type: 'ADJUST',
          quantity: 3,
          referenceType: 'PURCHASE_RECEIPT',
          referenceId: receiptId,
          notes: expect.stringMatching(
            /Ajuste \[Saldo pendiente\] \(OC: #OC-2026-001\)/,
          ),
        }),
        adminUser,
      );
      expect(tx.receiptItem.update).toHaveBeenCalledWith({
        where: { id: 'line-1' },
        data: { quantityReceived: { increment: 3 } },
      });
      expect(tx.warehouseReceipt.update).toHaveBeenCalledWith({
        where: { id: receiptId },
        data: { status: 'PARTIAL' },
      });
      expect(tx.purchaseOrder.update).toHaveBeenCalledWith({
        where: { id: poId },
        data: { status: 'PARTIALLY_RECEIVED' },
      });
      expect(result.transaction.id).toBe('txn-saldo');
    });

    it('marca guía COMPLETED y OC RECEIVED cuando el sync cubre todo', async () => {
      setupWarehouseAndItem(5, 10);
      prisma.warehouseReceipt.findFirst.mockResolvedValue({
        id: receiptId,
        purchaseOrderId: poId,
        warehouseId,
        status: 'PARTIAL',
      } as never);
      prisma.receiptItem.findMany.mockResolvedValue([
        {
          id: 'line-1',
          quantityExpected: 10,
          quantityReceived: 5,
        },
      ] as never);
      prisma.purchaseOrder.findFirst.mockResolvedValue({
        id: poId,
        correlative: 'OC-2026-001',
      } as never);

      stockService.performTransactionCore.mockResolvedValue({
        stock: { quantity: 10 },
        transaction: { id: 'txn-full' },
      } as never);

      prisma.$transaction.mockImplementation(async (fn) => {
        tx.receiptItem.findMany
          .mockResolvedValueOnce([
            {
              id: 'line-1',
              quantityExpected: 10,
              quantityReceived: 5,
            },
          ] as never)
          .mockResolvedValueOnce([
            { quantityExpected: 10, quantityReceived: 10 },
          ] as never);
        tx.receiptItem.update.mockResolvedValue({} as never);
        tx.warehouseReceipt.update.mockResolvedValue({} as never);
        tx.purchaseOrder.findFirst.mockResolvedValue({
          id: poId,
          status: 'PARTIALLY_RECEIVED',
          items: [{ id: 'oi-1', quantity: 10 }],
        } as never);
        tx.receiptItem.groupBy.mockResolvedValue([
          { orderItemId: 'oi-1', _sum: { quantityReceived: 10 } },
        ] as never);
        tx.purchaseOrder.update.mockResolvedValue({} as never);
        return (fn as (client: typeof tx) => Promise<unknown>)(tx);
      });

      await service.create(
        baseDto({
          reason: 'SALDO_PENDIENTE',
          newPhysicalQuantity: 10,
          purchaseOrderId: poId,
          purchaseReceiptId: receiptId,
          comment: 'Cierre total del saldo pendiente en esta guía.',
        }),
        adminUser,
      );

      expect(tx.warehouseReceipt.update).toHaveBeenCalledWith({
        where: { id: receiptId },
        data: { status: 'COMPLETED' },
      });
      expect(tx.purchaseOrder.update).toHaveBeenCalledWith({
        where: { id: poId },
        data: { status: 'RECEIVED' },
      });
    });
  });
});
