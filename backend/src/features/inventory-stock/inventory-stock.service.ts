import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TransactionType } from '@prisma/client';

export interface PerformTransactionDto {
  warehouseId: string;
  itemId: string;
  type: TransactionType;
  quantity: number;
  unitCost?: number;
  referenceId?: string;
  referenceType?: string;
  notes?: string;
}

export interface PerformReturnDto {
  warehouseId: string;
  itemId: string;
  quantity: number;
  workOrderId: string; // OT de la que se devuelve
  notes?: string;
}

@Injectable()
export class InventoryStockService {
  constructor(private readonly prisma: PrismaService) {}

  async getStockByWarehouse(warehouseId: string, user: any) {
    const warehouse = await this.prisma.warehouse.findFirst({
      where: { id: warehouseId, tenantId: user.tenantId },
    });
    if (!warehouse) throw new NotFoundException('Bodega no encontrada');

    return this.prisma.itemStock.findMany({
      where: { warehouseId },
      include: {
        item: true,
      },
      orderBy: { item: { name: 'asc' } },
    });
  }

  async getTransactionsByWarehouse(warehouseId: string, user: any) {
    return this.prisma.inventoryTransaction.findMany({
      where: { warehouseId, warehouse: { tenantId: user.tenantId } },
      include: {
        item: { select: { partNumber: true, name: true, unitOfMeasure: true } },
        user: { select: { name: true, email: true } },
      },
      orderBy: { date: 'desc' },
      take: 100,
    });
  }

  /**
   * Transacciones pendientes de regularización (stock negativo).
   */
  async getPendingRegularizations(user: any) {
    const tenantId = user.tenantId;
    return this.prisma.inventoryTransaction.findMany({
      where: {
        isPendingRegularization: true,
        warehouse: { tenantId },
      },
      include: {
        item: { select: { partNumber: true, name: true, unitOfMeasure: true } },
        warehouse: { select: { code: true, name: true } },
        user: { select: { name: true } },
      },
      orderBy: { date: 'desc' },
    });
  }

  /**
   * Conteo de transacciones pendientes de regularización.
   */
  async getPendingCount(user: any): Promise<number> {
    return this.prisma.inventoryTransaction.count({
      where: {
        isPendingRegularization: true,
        warehouse: { tenantId: user.tenantId },
      },
    });
  }

  /**
   * Ejecuta IN, OUT o ADJUST.
   * OUT ahora permite stock negativo, marcando isPendingRegularization.
   */
  async performTransaction(dto: PerformTransactionDto, user: any) {
    if (dto.quantity <= 0 && dto.type !== 'ADJUST') {
      throw new BadRequestException('La cantidad debe ser mayor a cero.');
    }

    const userId = user.id || user.sub;
    if (!userId) {
      throw new BadRequestException(
        'No se pudo identificar al usuario que realiza la transacción.',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const warehouse = await tx.warehouse.findFirst({
        where: { id: dto.warehouseId, tenantId: user.tenantId },
      });
      if (!warehouse) throw new NotFoundException('Bodega no válida.');

      const currentStock = await tx.itemStock.findUnique({
        where: {
          warehouseId_itemId: {
            warehouseId: dto.warehouseId,
            itemId: dto.itemId,
          },
        },
      });

      const previousQty = currentStock?.quantity || 0;
      let newQty = previousQty;
      let newUnitCost = currentStock?.unitCost || 0;
      let isPendingRegularization = false;

      if (dto.type === 'IN') {
        newQty = previousQty + dto.quantity;

        // Cálculo del Costo Promedio Ponderado (CPP)
        if (dto.unitCost && dto.unitCost > 0) {
          const totalValueBefore = previousQty * (currentStock?.unitCost || 0);
          const totalValueNew = dto.quantity * dto.unitCost;
          newUnitCost = (totalValueBefore + totalValueNew) / newQty;
        }
      } else if (dto.type === 'OUT') {
        newQty = previousQty - dto.quantity;
        // Stock negativo PERMITIDO — se marca para regularización
        if (newQty < 0) {
          isPendingRegularization = true;
        }
      } else if (dto.type === 'ADJUST') {
        newQty = previousQty + dto.quantity;
        // Los ajustes pueden dejar negativo también
        if (newQty < 0) {
          isPendingRegularization = true;
        }
      }

      const updatedStock = await tx.itemStock.upsert({
        where: {
          warehouseId_itemId: {
            warehouseId: dto.warehouseId,
            itemId: dto.itemId,
          },
        },
        update: {
          quantity: newQty,
          unitCost: newUnitCost,
        },
        create: {
          warehouseId: dto.warehouseId,
          itemId: dto.itemId,
          quantity: newQty,
          unitCost: dto.unitCost || 0,
        },
      });

      const transaction = await tx.inventoryTransaction.create({
        data: {
          type: dto.type,
          quantity: dto.quantity,
          previousStock: previousQty,
          newStock: newQty,
          isPendingRegularization,
          referenceId: dto.referenceId || null,
          referenceType: dto.referenceType || null,
          notes: dto.notes || null,
          warehouse: { connect: { id: dto.warehouseId } },
          item: { connect: { id: dto.itemId } },
          user: { connect: { id: userId } },
        },
      });

      return { stock: updatedStock, transaction };
    });
  }

  /**
   * Devolución (RETURN) atómica vinculada a una OT.
   * Valida que la cantidad devuelta no exceda la consumida originalmente.
   * Usa el unitCost original de la salida para proteger el CPP.
   */
  async performReturn(dto: PerformReturnDto, user: any) {
    if (dto.quantity <= 0) {
      throw new BadRequestException(
        'La cantidad a devolver debe ser mayor a cero.',
      );
    }

    const userId = user.id || user.sub;
    if (!userId) {
      throw new BadRequestException('No se pudo identificar al usuario.');
    }

    return this.prisma.$transaction(async (tx) => {
      // 1. Buscar todas las transacciones OUT de esta OT para este ítem en esta bodega
      const outTransactions = await tx.inventoryTransaction.findMany({
        where: {
          warehouseId: dto.warehouseId,
          itemId: dto.itemId,
          referenceId: dto.workOrderId,
          referenceType: 'WORK_ORDER',
          type: 'OUT',
        },
      });

      if (outTransactions.length === 0) {
        throw new BadRequestException(
          'No se encontraron salidas de este ítem para la OT especificada.',
        );
      }

      const totalConsumed = outTransactions.reduce(
        (sum, t) => sum + t.quantity,
        0,
      );

      // 2. Buscar devoluciones previas para no exceder el tope
      const previousReturns = await tx.inventoryTransaction.findMany({
        where: {
          warehouseId: dto.warehouseId,
          itemId: dto.itemId,
          referenceId: dto.workOrderId,
          referenceType: 'WORK_ORDER',
          type: 'RETURN',
        },
      });

      const totalReturned = previousReturns.reduce(
        (sum, t) => sum + t.quantity,
        0,
      );

      if (totalReturned + dto.quantity > totalConsumed) {
        throw new BadRequestException(
          `Devolución excede el consumo original. Consumido: ${totalConsumed}, Ya devuelto: ${totalReturned}, Intentando devolver: ${dto.quantity}.`,
        );
      }

      // 3. Obtener el unitCost original desde la primera salida
      const currentStock = await tx.itemStock.findUnique({
        where: {
          warehouseId_itemId: {
            warehouseId: dto.warehouseId,
            itemId: dto.itemId,
          },
        },
      });

      const previousQty = currentStock?.quantity || 0;
      const newQty = previousQty + dto.quantity;

      // Usar el unitCost del stock actual (no recalcular CPP en devoluciones)
      const unitCost = currentStock?.unitCost || 0;

      // 4. Actualizar stock
      await tx.itemStock.upsert({
        where: {
          warehouseId_itemId: {
            warehouseId: dto.warehouseId,
            itemId: dto.itemId,
          },
        },
        update: { quantity: newQty },
        create: {
          warehouseId: dto.warehouseId,
          itemId: dto.itemId,
          quantity: newQty,
          unitCost,
        },
      });

      // 5. Registrar transacción RETURN
      const transaction = await tx.inventoryTransaction.create({
        data: {
          type: 'RETURN',
          quantity: dto.quantity,
          previousStock: previousQty,
          newStock: newQty,
          referenceId: dto.workOrderId,
          referenceType: 'WORK_ORDER',
          notes: dto.notes || `Devolución de repuesto vinculada a OT`,
          isPendingRegularization: false,
          warehouse: { connect: { id: dto.warehouseId } },
          item: { connect: { id: dto.itemId } },
          user: { connect: { id: userId } },
        },
      });

      // 6. Si la devolución resuelve un stock que estaba negativo,
      //    verificar si ahora es >= 0 y limpiar flags de regularización
      if (newQty >= 0) {
        // Marcar como regularizadas las transacciones pendientes de este ítem/bodega
        await tx.inventoryTransaction.updateMany({
          where: {
            warehouseId: dto.warehouseId,
            itemId: dto.itemId,
            isPendingRegularization: true,
          },
          data: { isPendingRegularization: false },
        });
      }

      return { newStock: newQty, transaction };
    });
  }
}
