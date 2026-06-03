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
import {
  getPolicyThresholdsForNewItemStockRow,
  clearItemStockPolicyIfMatchesWarehouse,
} from '../inventory-items/inventory-item-stock-policy.helper';
import { SystemPermissions } from '../auth/constants/permissions.enum';
import { userHasPermission } from '../auth/permissions.util';

export interface ListInventoryTransfersQuery {
  page?: string;
  pageSize?: string;
  /** createdAt | origin | dest | status */
  sort?: string;
  /** asc | desc */
  dir?: string;
}

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

  private assertCanCreateTransfer(user: {
    role?: string;
    permissions?: string[];
  }) {
    if (!userHasPermission(user, SystemPermissions.INVENTORY_TRANSFER_CREATE)) {
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

  private mapTransferMutationIncludes() {
    return {
      lines: true,
      originWarehouse: {
        select: { id: true, code: true, name: true, contractId: true },
      },
      destinationWarehouse: {
        select: { id: true, code: true, name: true, contractId: true },
      },
      createdBy: { select: { id: true, name: true, email: true } },
    } as const;
  }

  private mapTransferListInclude() {
    return {
      _count: { select: { lines: true } },
      originWarehouse: {
        select: { id: true, code: true, name: true, contractId: true },
      },
      destinationWarehouse: {
        select: { id: true, code: true, name: true, contractId: true },
      },
      createdBy: { select: { id: true, name: true, email: true } },
    } as const;
  }

  private mapTransferDetailIncludes() {
    return {
      lines: {
        include: {
          item: {
            select: {
              id: true,
              partNumber: true,
              name: true,
              inventoryCode: true,
              unitOfMeasure: {
                select: { abbreviation: true, allowsDecimals: true },
              },
            },
          },
        },
      },
      originWarehouse: {
        select: { id: true, code: true, name: true, contractId: true },
      },
      destinationWarehouse: {
        select: { id: true, code: true, name: true, contractId: true },
      },
      createdBy: { select: { id: true, name: true, email: true } },
    } as const;
  }

  private buildTransferListWhere(
    user: any,
  ): Prisma.InventoryTransferWhereInput {
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
    return where;
  }

  private parseListQuery(query?: ListInventoryTransfersQuery) {
    const page = Math.max(1, parseInt(String(query?.page ?? '1'), 10) || 1);
    const pageSizeRaw = parseInt(String(query?.pageSize ?? '25'), 10) || 25;
    const pageSize = Math.min(100, Math.max(1, pageSizeRaw));
    const sortRaw = String(query?.sort ?? 'createdAt').toLowerCase();
    const dir: Prisma.SortOrder =
      String(query?.dir ?? 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';

    let orderBy: Prisma.InventoryTransferOrderByWithRelationInput;
    switch (sortRaw) {
      case 'origin':
        orderBy = { originWarehouse: { code: dir } };
        break;
      case 'dest':
      case 'destination':
        orderBy = { destinationWarehouse: { code: dir } };
        break;
      case 'status':
        orderBy = { status: dir };
        break;
      default:
        orderBy = { createdAt: dir };
    }

    return { page, pageSize, orderBy, sort: sortRaw, dir };
  }

  async listTransfers(user: any, query?: ListInventoryTransfersQuery) {
    const where = this.buildTransferListWhere(user);
    const { page, pageSize, orderBy } = this.parseListQuery(query);
    const skip = (page - 1) * pageSize;

    const [rows, total] = await Promise.all([
      this.prisma.inventoryTransfer.findMany({
        where,
        include: this.mapTransferListInclude(),
        orderBy,
        skip,
        take: pageSize,
      }),
      this.prisma.inventoryTransfer.count({ where }),
    ]);

    const data = rows.map((r) => {
      const { _count, ...rest } = r;
      return {
        ...rest,
        lineCount: _count.lines,
      };
    });

    return { data, total, page, pageSize };
  }

  async getTransferById(transferId: string, user: any) {
    const where = this.buildTransferListWhere(user);
    const transfer = await this.prisma.inventoryTransfer.findFirst({
      where: { ...where, id: transferId },
      include: this.mapTransferDetailIncludes(),
    });
    if (!transfer) {
      throw new NotFoundException('Transferencia no encontrada.');
    }

    let reception: {
      at: string;
      user: { id: string; name: string; email: string };
    } | null = null;
    if (transfer.status === 'COMPLETED') {
      const lastIn = await this.prisma.inventoryTransaction.findFirst({
        where: {
          referenceId: transfer.id,
          referenceType: 'INVENTORY_TRANSFER',
          type: TransactionType.TRANSFER_IN,
          warehouseId: transfer.destinationWarehouseId,
        },
        orderBy: { date: 'desc' },
        include: { user: { select: { id: true, name: true, email: true } } },
      });
      if (lastIn?.user) {
        reception = {
          at: lastIn.date.toISOString(),
          user: lastIn.user,
        };
      }
    }

    return { ...transfer, reception };
  }

  async executeTransfer(dto: CreateInventoryTransferDto, user: any) {
    this.assertCanCreateTransfer(user);
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
        this.assertCanCreateTransfer(user);
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
        if (!this.canAccessContract(user, origin.contractId)) {
          throw new ForbiddenException(
            'No tiene permisos para despachar desde esta bodega de origen.',
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
            select: {
              id: true,
              partNumber: true,
              unitOfMeasure: {
                select: { abbreviation: true, allowsDecimals: true },
              },
            },
          });
          if (!item) {
            throw new BadRequestException(
              `El artículo no existe o no pertenece a su empresa.`,
            );
          }

          if (
            !item.unitOfMeasure?.allowsDecimals &&
            !Number.isInteger(line.quantity)
          ) {
            throw new BadRequestException(
              `El artículo "${item.partNumber ?? item.id}" usa unidad "${item.unitOfMeasure?.abbreviation ?? 'UN'}" que no admite fracciones. La cantidad debe ser un número entero.`,
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
          include: this.mapTransferMutationIncludes(),
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

          const policyDefaults = !destStock
            ? await getPolicyThresholdsForNewItemStockRow(
                tx,
                tenantId,
                line.itemId,
                transfer.destinationWarehouse.id,
              )
            : { minStock: 0, maxStock: 0 };

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
              minStock: policyDefaults.minStock,
              maxStock: policyDefaults.maxStock,
            },
          });

          await clearItemStockPolicyIfMatchesWarehouse(
            tx,
            tenantId,
            line.itemId,
            transfer.destinationWarehouse.id,
          );

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
          include: this.mapTransferMutationIncludes(),
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
