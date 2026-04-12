import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SequenceService } from '../../common/sequence/sequence.service';

const RECEIPT_DETAIL_INCLUDE = {
  purchaseOrder: {
    select: { id: true, correlative: true, totalAmount: true, status: true },
  },
  warehouse: { select: { id: true, code: true, name: true } },
  receivedBy: { select: { id: true, name: true } },
  items: {
    include: {
      orderItem: {
        include: {
          inventoryItem: {
            select: { id: true, partNumber: true, name: true, unitOfMeasure: true },
          },
        },
      },
    },
  },
} as const;

@Injectable()
export class WarehouseReceiptsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequenceService: SequenceService,
  ) {}

  async findAll(tenantId: string) {
    return this.prisma.warehouseReceipt.findMany({
      where: { tenantId },
      include: {
        purchaseOrder: {
          select: { id: true, correlative: true, totalAmount: true },
        },
        warehouse: { select: { id: true, code: true, name: true } },
        receivedBy: { select: { id: true, name: true } },
        _count: { select: { items: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(id: string, tenantId: string) {
    const receipt = await this.prisma.warehouseReceipt.findFirst({
      where: { id, tenantId },
      include: RECEIPT_DETAIL_INCLUDE,
    });
    if (!receipt) throw new NotFoundException('Recepción no encontrada');
    return receipt;
  }

  async create(
    data: { purchaseOrderId: string; warehouseId: string },
    user: any,
  ) {
    const tenantId = user.tenantId;

    return this.prisma.$transaction(async (tx) => {
      const order = await tx.purchaseOrder.findFirst({
        where: {
          id: data.purchaseOrderId,
          tenantId,
          status: { in: ['APPROVED', 'SENT_TO_SUPPLIER', 'PARTIALLY_RECEIVED'] },
        },
        include: { items: true },
      });

      if (!order) {
        throw new BadRequestException(
          'OC no encontrada o no está en estado válido para recepción',
        );
      }

      const warehouse = await tx.warehouse.findFirst({
        where: { id: data.warehouseId, tenantId },
      });
      if (!warehouse) throw new NotFoundException('Bodega no encontrada');

      const correlative = await this.sequenceService.getNextCorrelative(
        tenantId, 'WR', 'WR', tx,
      );

      return tx.warehouseReceipt.create({
        data: {
          tenantId,
          purchaseOrderId: data.purchaseOrderId,
          warehouseId: data.warehouseId,
          receivedById: user.id,
          correlative,
          items: {
            create: order.items.map((oi) => ({
              orderItemId: oi.id,
              quantityExpected: oi.quantity,
              quantityReceived: 0,
            })),
          },
        },
        include: {
          items: {
            include: {
              orderItem: {
                include: {
                  inventoryItem: {
                    select: { id: true, partNumber: true, name: true },
                  },
                },
              },
            },
          },
        },
      });
    });
  }

  async updateItems(
    receiptId: string,
    items: Array<{
      id: string;
      quantityReceived: number;
      observations?: string;
    }>,
    user: any,
  ) {
    const receipt = await this.findById(receiptId, user.tenantId);

    if (receipt.status === 'COMPLETED') {
      throw new BadRequestException('Esta recepción ya fue confirmada');
    }

    return this.prisma.$transaction(
      items.map((item) =>
        this.prisma.receiptItem.update({
          where: { id: item.id },
          data: {
            quantityReceived: item.quantityReceived,
            observations: item.observations,
          },
        }),
      ),
    );
  }

  async confirm(receiptId: string, user: any) {
    const receipt = await this.findById(receiptId, user.tenantId);

    if (receipt.status === 'COMPLETED') {
      throw new BadRequestException('Esta recepción ya fue confirmada');
    }

    const totalReceived = receipt.items.reduce(
      (sum, i) => sum + Number(i.quantityReceived),
      0,
    );
    if (totalReceived <= 0) {
      throw new BadRequestException(
        'No se puede confirmar una recepción sin materiales. Si no recibirá nada, utilice el Cierre Administrativo.',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      let allComplete = true;

      for (const item of receipt.items) {
        if (item.quantityReceived <= 0) continue;

        const inventoryItemId = item.orderItem.inventoryItemId;
        if (!inventoryItemId) continue;

        const existingStock = await tx.itemStock.findUnique({
          where: {
            warehouseId_itemId: {
              warehouseId: receipt.warehouseId,
              itemId: inventoryItemId,
            },
          },
        });

        const previousStock = existingStock?.quantity ?? 0;
        const newStock = previousStock + item.quantityReceived;

        await tx.itemStock.upsert({
          where: {
            warehouseId_itemId: {
              warehouseId: receipt.warehouseId,
              itemId: inventoryItemId,
            },
          },
          create: {
            warehouseId: receipt.warehouseId,
            itemId: inventoryItemId,
            quantity: item.quantityReceived,
            unitCost: Number(item.orderItem.unitCost),
          },
          update: {
            quantity: { increment: item.quantityReceived },
            unitCost: Number(item.orderItem.unitCost),
          },
        });

        await tx.inventoryTransaction.create({
          data: {
            warehouseId: receipt.warehouseId,
            itemId: inventoryItemId,
            userId: user.id,
            type: 'IN',
            quantity: item.quantityReceived,
            previousStock,
            newStock,
            referenceId: receipt.id,
            referenceType: 'PURCHASE_RECEIPT',
            notes: item.observations
              ? `Recepción ${receipt.correlative}: ${item.observations}`
              : `Recepción ${receipt.correlative}`,
          },
        });

        if (item.quantityReceived < item.quantityExpected) {
          allComplete = false;
        }
      }

      const receiptStatus = allComplete ? 'COMPLETED' : 'PARTIAL';
      const poStatus = allComplete ? 'RECEIVED' : 'PARTIALLY_RECEIVED';

      await tx.warehouseReceipt.update({
        where: { id: receiptId },
        data: {
          status: receiptStatus,
          receivedAt: new Date(),
          observations: receipt.observations,
        },
      });

      await tx.purchaseOrder.update({
        where: { id: receipt.purchaseOrderId },
        data: { status: poStatus },
      });
    });

    return this.findById(receiptId, user.tenantId);
  }
}
