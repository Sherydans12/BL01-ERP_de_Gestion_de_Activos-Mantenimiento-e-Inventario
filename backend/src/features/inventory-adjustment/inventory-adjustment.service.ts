import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryStockService } from '../inventory-stock/inventory-stock.service';
import { SystemPermissions } from '../auth/constants/permissions.enum';
import { userHasPermission } from '../auth/permissions.util';

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

const PO_STATUSES_ALLOW_RECEIPT_PROGRESS_SYNC = new Set<string>([
  'SENT',
  'ORDERED',
  'SENT_TO_SUPPLIER',
  'PARTIALLY_RECEIVED',
]);

@Injectable()
export class InventoryAdjustmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventoryStockService: InventoryStockService,
  ) {}

  private assertCanAdjust(user: { role?: string; permissions?: string[] }) {
    if (!userHasPermission(user, SystemPermissions.INVENTORY_STOCK_ADJUST)) {
      throw new ForbiddenException(
        'No tiene permisos para ejecutar ajustes de inventario.',
      );
    }
  }

  /**
   * Tras un ADJUST positivo «Saldo pendiente», incrementa `quantity_received` en las líneas
   * de la guía vinculada (mismo ítem de catálogo), actualiza estado de la guía y progreso de la OC.
   */
  private async syncSaldoPendienteIntoReceiptAndPo(
    tx: Prisma.TransactionClient,
    args: {
      tenantId: string;
      receiptId: string;
      poId: string;
      itemId: string;
      qty: number;
    },
  ): Promise<void> {
    let remaining = args.qty;
    const lines = await tx.receiptItem.findMany({
      where: {
        receiptId: args.receiptId,
        orderItem: {
          inventoryItemId: args.itemId,
          purchaseOrderId: args.poId,
        },
      },
      orderBy: { id: 'asc' },
      select: { id: true, quantityExpected: true, quantityReceived: true },
    });
    for (const ln of lines) {
      if (remaining <= 1e-9) break;
      const room = Math.max(
        0,
        Number(ln.quantityExpected) - Number(ln.quantityReceived),
      );
      const add = Math.min(remaining, room);
      if (add <= 1e-9) continue;
      await tx.receiptItem.update({
        where: { id: ln.id },
        data: { quantityReceived: { increment: add } },
      });
      remaining -= add;
    }
    if (remaining > 1e-9) {
      throw new BadRequestException(
        'Inconsistencia al sincronizar la recepción: no se pudo asignar todo el saldo a las líneas de la guía.',
      );
    }

    const docItems = await tx.receiptItem.findMany({
      where: { receiptId: args.receiptId },
      select: { quantityExpected: true, quantityReceived: true },
    });
    let allDocComplete = true;
    let anyReceived = false;
    for (const it of docItems) {
      if (Number(it.quantityReceived) > 1e-9) anyReceived = true;
      if (Number(it.quantityReceived) + 1e-9 < Number(it.quantityExpected)) {
        allDocComplete = false;
      }
    }
    const nextReceiptStatus = !anyReceived
      ? 'PENDING'
      : allDocComplete
        ? 'COMPLETED'
        : 'PARTIAL';
    await tx.warehouseReceipt.update({
      where: { id: args.receiptId },
      data: { status: nextReceiptStatus },
    });

    const order = await tx.purchaseOrder.findFirst({
      where: { id: args.poId, tenantId: args.tenantId },
      select: {
        id: true,
        status: true,
        items: { select: { id: true, quantity: true } },
      },
    });
    if (!order || ['CANCELLED', 'CLOSED'].includes(order.status)) {
      return;
    }
    if (order.status === 'RECEIVED') {
      return;
    }
    if (!PO_STATUSES_ALLOW_RECEIPT_PROGRESS_SYNC.has(order.status)) {
      return;
    }

    const oiIds = order.items.map((i) => i.id);
    if (oiIds.length === 0) return;

    const sums = await tx.receiptItem.groupBy({
      by: ['orderItemId'],
      where: {
        orderItemId: { in: oiIds },
        receipt: { purchaseOrderId: args.poId, tenantId: args.tenantId },
      },
      _sum: { quantityReceived: true },
    });
    const sumMap = new Map(
      sums.map((s) => [s.orderItemId, Number(s._sum.quantityReceived ?? 0)]),
    );
    let allLinesFull = true;
    let anyProgress = false;
    for (const oi of order.items) {
      const rec = sumMap.get(oi.id) ?? 0;
      const need = Number(oi.quantity);
      if (rec + 1e-9 < need) allLinesFull = false;
      if (rec > 1e-9) anyProgress = true;
    }
    if (!anyProgress) return;

    const poStatus = allLinesFull ? 'RECEIVED' : 'PARTIALLY_RECEIVED';
    await tx.purchaseOrder.update({
      where: { id: args.poId },
      data: { status: poStatus },
    });
  }

  async create(dto: CreateInventoryAdjustmentDto, user: any) {
    this.assertCanAdjust(user);
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
          status: true,
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
      if (receipt.status === 'PENDING') {
        throw new BadRequestException(
          'La guía de recepción debe estar confirmada al menos en forma parcial antes de usar «Saldo pendiente». Confirme primero en compras la recepción que registró el ingreso parcial a bodega.',
        );
      }
      if (delta <= 0) {
        throw new BadRequestException(
          '«Saldo pendiente» vía compras solo aplica a incrementos de stock (diferencia positiva respecto al saldo actual).',
        );
      }

      const lines = await this.prisma.receiptItem.findMany({
        where: {
          receiptId: receiptId!,
          orderItem: {
            inventoryItemId: dto.itemId,
            purchaseOrderId: poId,
          },
        },
        select: { id: true, quantityExpected: true, quantityReceived: true },
      });
      let roomTotal = 0;
      for (const ln of lines) {
        roomTotal += Math.max(
          0,
          Number(ln.quantityExpected) - Number(ln.quantityReceived),
        );
      }
      if (!lines.length) {
        throw new BadRequestException(
          'La recepción no tiene líneas vinculadas a este artículo de catálogo en la OC indicada.',
        );
      }
      if (roomTotal + 1e-9 < delta) {
        throw new BadRequestException(
          'La recepción vinculada no tiene pendiente suficiente en esta línea para registrar esta cantidad. Verifique la guía, la OC o el artículo.',
        );
      }

      const po = await this.prisma.purchaseOrder.findFirst({
        where: { id: poId, tenantId },
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

    this.assertCanAdjust(user);

    if (dto.reason === 'SALDO_PENDIENTE') {
      return this.prisma.$transaction(
        async (tx) => {
          const out = await this.inventoryStockService.performTransactionCore(
            tx,
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
          await this.syncSaldoPendienteIntoReceiptAndPo(tx, {
            tenantId,
            receiptId: receiptId!,
            poId: poId!,
            itemId: dto.itemId,
            qty: delta,
          });
          return out;
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 10_000,
          timeout: 60_000,
        },
      );
    }

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
