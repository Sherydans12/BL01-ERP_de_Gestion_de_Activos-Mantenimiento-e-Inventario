import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryStockService } from '../inventory-stock/inventory-stock.service';

/** Motivos contables obligatorios para ajuste de inventario físico. */
export const ADJUSTMENT_REASON_CODES = [
  'MERMAS',
  'CONTEO',
  'DANO',
  'SALDO_PENDIENTE',
] as const;

export type AdjustmentReasonCode = (typeof ADJUSTMENT_REASON_CODES)[number];

export interface CreateInventoryAdjustmentDto {
  warehouseId: string;
  itemId: string;
  /** Cantidad física contada / reconocida en bodega. */
  newPhysicalQuantity: number;
  reason: AdjustmentReasonCode;
  comment: string;
  /** Obligatorios si `reason === 'SALDO_PENDIENTE'`. */
  purchaseOrderId?: string;
  purchaseReceiptId?: string;
}

const REASON_LABEL: Record<AdjustmentReasonCode, string> = {
  MERMAS: 'Mermas',
  CONTEO: 'Error de conteo',
  DANO: 'Daño',
  SALDO_PENDIENTE: 'Saldo pendiente',
};

/** Para MERMAS/DANO se exige explicación auditable (no basta un comentario de un carácter). */
const LOSS_DAMAGE_COMMENT_MIN_LEN = 15;

@Injectable()
export class InventoryAdjustmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventoryStockService: InventoryStockService,
  ) {}

  private assertPrivilegedRole(user: any) {
    const role = String(user?.role ?? '').toUpperCase();
    if (!['ADMIN', 'SUPERVISOR', 'SUPER_ADMIN'].includes(role)) {
      throw new ForbiddenException(
        'No tiene permisos para ejecutar ajustes de inventario.',
      );
    }
  }

  async create(dto: CreateInventoryAdjustmentDto, user: any) {
    this.assertPrivilegedRole(user);
    const tenantId = user.tenantId as string;
    const comment = dto.comment?.trim();
    if (!comment?.length) {
      throw new BadRequestException('El comentario del ajuste es obligatorio.');
    }
    if (
      (dto.reason === 'MERMAS' || dto.reason === 'DANO') &&
      comment.length < LOSS_DAMAGE_COMMENT_MIN_LEN
    ) {
      throw new BadRequestException(
        `Para merma o daño debe registrar una explicación detallada en el comentario (mínimo ${LOSS_DAMAGE_COMMENT_MIN_LEN} caracteres).`,
      );
    }
    if (!ADJUSTMENT_REASON_CODES.includes(dto.reason)) {
      throw new BadRequestException('Motivo de ajuste no válido.');
    }

    const poId = dto.purchaseOrderId?.trim();
    const receiptId = dto.purchaseReceiptId?.trim();

    if (dto.reason === 'SALDO_PENDIENTE') {
      if (!poId || !receiptId) {
        throw new BadRequestException(
          'La Orden de Compra y la Recepción son obligatorias para este motivo',
        );
      }
    }

    if (
      typeof dto.newPhysicalQuantity !== 'number' ||
      Number.isNaN(dto.newPhysicalQuantity) ||
      dto.newPhysicalQuantity < 0
    ) {
      throw new BadRequestException(
        'La cantidad física debe ser un número mayor o igual a cero.',
      );
    }

    const warehouse = await this.prisma.warehouse.findFirst({
      where: { id: dto.warehouseId, tenantId },
      select: { id: true },
    });
    if (!warehouse) {
      throw new NotFoundException('Bodega no encontrada.');
    }

    const item = await this.prisma.inventoryItem.findFirst({
      where: { id: dto.itemId, tenantId },
      select: { id: true },
    });
    if (!item) {
      throw new NotFoundException('Artículo no encontrado.');
    }

    const currentStock = await this.prisma.itemStock.findUnique({
      where: {
        warehouseId_itemId: {
          warehouseId: dto.warehouseId,
          itemId: dto.itemId,
        },
      },
    });

    const previousQty = currentStock?.quantity ?? 0;
    const cpp = Number(currentStock?.unitCost ?? 0);
    const delta = dto.newPhysicalQuantity - previousQty;

    if (Math.abs(delta) < 1e-9) {
      throw new BadRequestException(
        'No hay diferencia entre el stock actual y la cantidad física indicada.',
      );
    }

    let notes: string;
    let referenceId: string | undefined;
    let referenceType: string | undefined;

    if (dto.reason === 'SALDO_PENDIENTE') {
      const receipt = await this.prisma.warehouseReceipt.findFirst({
        where: { id: receiptId!, tenantId },
        select: {
          id: true,
          purchaseOrderId: true,
          warehouseId: true,
        },
      });
      if (!receipt) {
        throw new NotFoundException('Recepción no encontrada.');
      }
      if (receipt.purchaseOrderId !== poId) {
        throw new BadRequestException(
          'La recepción seleccionada no corresponde a la orden de compra indicada.',
        );
      }
      if (receipt.warehouseId !== dto.warehouseId) {
        throw new BadRequestException(
          'La recepción pertenece a otra bodega; seleccione una recepción de esta bodega.',
        );
      }
      const po = await this.prisma.purchaseOrder.findFirst({
        where: { id: poId!, tenantId },
        select: { id: true, correlative: true },
      });
      if (!po) {
        throw new NotFoundException('Orden de compra no encontrada.');
      }

      const ocLabel = String(po.correlative ?? '').trim() || po.id;
      notes = `Ajuste [Saldo pendiente] (OC: #${ocLabel}): ${comment}`;
      referenceId = receipt.id;
      referenceType = 'PURCHASE_RECEIPT';
    } else {
      const reasonLabel = REASON_LABEL[dto.reason];
      notes = `Ajuste [${reasonLabel}]: ${comment}`;
      referenceType = 'INVENTORY_ADJUSTMENT';
    }

    // Revalidación justo antes de ejecutar la operación transaccional.
    this.assertPrivilegedRole(user);
    return this.inventoryStockService.performTransaction(
      {
        warehouseId: dto.warehouseId,
        itemId: dto.itemId,
        type: 'ADJUST',
        quantity: delta,
        unitCost: delta > 0 ? cpp : undefined,
        notes,
        referenceId,
        referenceType,
      },
      user,
    );
  }
}
