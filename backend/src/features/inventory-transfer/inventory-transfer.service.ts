import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, TransactionType } from '@prisma/client';
import Decimal from 'decimal.js';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryStockService } from '../inventory-stock/inventory-stock.service';

export interface TransferLineDto {
  itemId: string;
  quantity: number;
}

export interface CreateInventoryTransferDto {
  originWarehouseId: string;
  destinationWarehouseId: string;
  lines: TransferLineDto[];
}

@Injectable()
export class InventoryTransferService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventoryStockService: InventoryStockService,
  ) {}

  private assertPrivilegedRole(user: any) {
    const role = String(user?.role ?? '').toUpperCase();
    if (!['ADMIN', 'SUPERVISOR', 'SUPER_ADMIN'].includes(role)) {
      throw new ForbiddenException(
        'No tiene permisos para ejecutar transferencias entre bodegas.',
      );
    }
  }

  private weightedAverageCpp(
    prevQty: number,
    prevCpp: number,
    addQty: number,
    addCpp: number,
  ): number {
    const pQ = new Decimal(prevQty);
    const pC = new Decimal(prevCpp);
    const aQ = new Decimal(addQty);
    const aC = new Decimal(addCpp);
    const tQ = pQ.plus(aQ);
    if (tQ.isZero()) return 0;
    return parseFloat(pQ.mul(pC).plus(aQ.mul(aC)).div(tQ).toFixed(4));
  }

  private canAccessContract(user: any, contractId: string): boolean {
    const role = String(user?.role ?? '').toUpperCase();
    if (role === 'ADMIN' || role === 'SUPER_ADMIN') return true;
    const allowed = Array.isArray(user?.allowedContracts)
      ? (user.allowedContracts as string[])
      : [];
    return allowed.includes(contractId);
  }

  private mapTransferIncludes() {
    return {
      lines: true,
      originWarehouse: { select: { id: true, code: true, name: true } },
      destinationWarehouse: { select: { id: true, code: true, name: true } },
    } as const;
  }

  async listTransfers(user: any) {
    const tenantId = user.tenantId as string;
    const role = String(user?.role ?? '').toUpperCase();
    const isAdminLike = role === 'ADMIN' || role === 'SUPER_ADMIN';
    const allowedContracts = Array.isArray(user?.allowedContracts)
      ? (user.allowedContracts as string[])
      : [];

    const where: Prisma.InventoryTransferWhereInput = { tenantId };
    if (!isAdminLike) {
      where.OR = [
        { originWarehouse: { contractId: { in: allowedContracts } } },
        { destinationWarehouse: { contractId: { in: allowedContracts } } },
      ];
    }

    return this.prisma.inventoryTransfer.findMany({
      where,
      include: this.mapTransferIncludes(),
      orderBy: { createdAt: 'desc' },
    });
  }

  async executeTransfer(dto: CreateInventoryTransferDto, user: any) {
    this.assertPrivilegedRole(user);
    const tenantId = user.tenantId as string;
    const userId = (user.id || user.sub) as string;
    if (!userId) {
      throw new BadRequestException('Usuario no identificado.');
    }

    if (dto.originWarehouseId === dto.destinationWarehouseId) {
      throw new BadRequestException(
        'La bodega de origen y destino deben ser distintas.',
      );
    }
    if (!dto.lines?.length) {
      throw new BadRequestException(
        'Indique al menos una línea de transferencia.',
      );
    }

    for (const l of dto.lines) {
      if (l.quantity <= 0 || Number.isNaN(l.quantity)) {
        throw new BadRequestException(
          'Las cantidades deben ser mayores a cero.',
        );
      }
    }

    return this.prisma.$transaction(
      async (tx) => {
        // Defensa en profundidad: revalidamos permisos al entrar en la transacción.
        this.assertPrivilegedRole(user);
        const [origin, dest] = await Promise.all([
          tx.warehouse.findFirst({
            where: { id: dto.originWarehouseId, tenantId },
          }),
          tx.warehouse.findFirst({
            where: { id: dto.destinationWarehouseId, tenantId },
          }),
        ]);
        if (!origin || !dest) {
          throw new NotFoundException(
            'Bodega de origen o destino no encontrada.',
          );
        }

        const transfer = await tx.inventoryTransfer.create({
          data: {
            tenantId,
            originWarehouseId: origin.id,
            destinationWarehouseId: dest.id,
            status: 'SHIPPED',
            createdById: userId,
          },
        });

        const noteBase = `Transferencia ${origin.code} → ${dest.code}`;

        for (const line of dto.lines) {
          const item = await tx.inventoryItem.findFirst({
            where: { id: line.itemId, tenantId },
            select: { id: true, partNumber: true },
          });
          if (!item) {
            throw new BadRequestException(
              `El artículo no existe o no pertenece a su empresa.`,
            );
          }

          const originStock = await tx.itemStock.findUnique({
            where: {
              warehouseId_itemId: {
                warehouseId: origin.id,
                itemId: line.itemId,
              },
            },
          });

          const prevO = originStock?.quantity ?? 0;
          if (prevO + 1e-9 < line.quantity) {
            throw new BadRequestException(
              `Stock insuficiente en origen para ${item.partNumber}. Disponible: ${prevO}, solicitado: ${line.quantity}.`,
            );
          }

          const cppOrigin = Number(originStock?.unitCost ?? 0);
          const newOriginQty = prevO - line.quantity;

          await tx.itemStock.update({
            where: {
              warehouseId_itemId: {
                warehouseId: origin.id,
                itemId: line.itemId,
              },
            },
            data: { quantity: newOriginQty },
          });

          await tx.inventoryTransferLine.create({
            data: {
              transferId: transfer.id,
              itemId: line.itemId,
              quantity: line.quantity,
              unitCost: cppOrigin,
            },
          });

          const notes = `${noteBase} · Traslado de ${line.quantity} u.`;

          await tx.inventoryTransaction.create({
            data: {
              type: TransactionType.TRANSFER_OUT,
              quantity: line.quantity,
              previousStock: prevO,
              newStock: newOriginQty,
              referenceId: transfer.id,
              referenceType: 'INVENTORY_TRANSFER',
              notes,
              warehouseId: origin.id,
              itemId: line.itemId,
              userId,
            },
          });
        }

        return tx.inventoryTransfer.findUnique({
          where: { id: transfer.id },
          include: this.mapTransferIncludes(),
        });
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10_000,
        timeout: 60_000,
      },
    );
  }

  async confirmReception(transferId: string, user: any) {
    const tenantId = user.tenantId as string;
    const userId = (user.id || user.sub) as string;
    if (!userId) {
      throw new BadRequestException('Usuario no identificado.');
    }

    return this.prisma.$transaction(
      async (tx) => {
        const transfer = await tx.inventoryTransfer.findFirst({
          where: { id: transferId, tenantId },
          include: {
            lines: true,
            originWarehouse: {
              select: { id: true, code: true, name: true, contractId: true },
            },
            destinationWarehouse: {
              select: { id: true, code: true, name: true, contractId: true },
            },
          },
        });

        if (!transfer) {
          throw new NotFoundException('Transferencia no encontrada.');
        }
        if (transfer.status !== 'SHIPPED') {
          throw new BadRequestException(
            'Solo transferencias en estado SHIPPED pueden recibirse.',
          );
        }
        if (
          !this.canAccessContract(
            user,
            transfer.destinationWarehouse.contractId,
          )
        ) {
          throw new ForbiddenException(
            'No tiene permisos para confirmar recepción en esta bodega destino.',
          );
        }

        const noteBase = `Transferencia ${transfer.originWarehouse.code} → ${transfer.destinationWarehouse.code}`;

        for (const line of transfer.lines) {
          const destStock = await tx.itemStock.findUnique({
            where: {
              warehouseId_itemId: {
                warehouseId: transfer.destinationWarehouse.id,
                itemId: line.itemId,
              },
            },
          });

          const prevD = destStock?.quantity ?? 0;
          const cppDest = Number(destStock?.unitCost ?? 0);
          const incomingCost = Number(line.unitCost ?? 0);
          const newDestQty = prevD + line.quantity;
          const newCppDest =
            prevD <= 1e-9
              ? incomingCost
              : this.weightedAverageCpp(
                  prevD,
                  cppDest,
                  line.quantity,
                  incomingCost,
                );

          await tx.itemStock.upsert({
            where: {
              warehouseId_itemId: {
                warehouseId: transfer.destinationWarehouse.id,
                itemId: line.itemId,
              },
            },
            update: {
              quantity: newDestQty,
              unitCost: newCppDest,
            },
            create: {
              warehouseId: transfer.destinationWarehouse.id,
              itemId: line.itemId,
              quantity: newDestQty,
              unitCost: incomingCost,
            },
          });

          const notes = `${noteBase} · Recepción de ${line.quantity} u.`;
          await tx.inventoryTransaction.create({
            data: {
              type: TransactionType.TRANSFER_IN,
              quantity: line.quantity,
              previousStock: prevD,
              newStock: newDestQty,
              referenceId: transfer.id,
              referenceType: 'INVENTORY_TRANSFER',
              notes,
              warehouseId: transfer.destinationWarehouse.id,
              itemId: line.itemId,
              userId,
            },
          });

          await this.inventoryStockService.clearPendingRegularizationFlags(
            tx,
            transfer.destinationWarehouse.id,
            line.itemId,
            newDestQty,
          );
        }

        await tx.inventoryTransfer.update({
          where: { id: transfer.id },
          data: { status: 'COMPLETED' },
        });

        return tx.inventoryTransfer.findUnique({
          where: { id: transfer.id },
          include: this.mapTransferIncludes(),
        });
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10_000,
        timeout: 60_000,
      },
    );
  }
}
