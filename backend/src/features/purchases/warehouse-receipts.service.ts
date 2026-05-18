import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import Decimal from 'decimal.js';
import { PrismaService } from '../../prisma/prisma.service';
import { SequenceService } from '../../common/sequence/sequence.service';
import { AuditService } from '../../common/audit/audit.service';
import {
  EQUIPMENT_LINK_SELECT,
  WORK_ORDER_LINK_SELECT,
} from './purchase-asset-links.include';
import { assertUserHasContractAccess } from './purchase-contract-access.util';
import { PO_STATUSES_ALLOW_WAREHOUSE_RECEIPT } from './po-receipt-eligible-statuses';
import { InventoryStockService } from '../inventory-stock/inventory-stock.service';
import {
  getPolicyThresholdsForNewItemStockRow,
  clearItemStockPolicyIfMatchesWarehouse,
} from '../inventory-items/inventory-item-stock-policy.helper';
import {
  requisitionIdFromPurchaseOrder,
  tryAutoCloseRequisitionIfFullyReconciled,
} from './purchase-requisition-auto-close.util';

const WR_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isReceiptListUuid(value: string | undefined | null): boolean {
  return typeof value === 'string' && WR_UUID_RE.test(value);
}

const WR_LIST_SEARCH_MAX_LEN = 120;
const WR_LIST_PAGE_SIZE_MAX = 100;

const WR_LIST_SORT_FIELDS = [
  'correlative',
  'status',
  'createdAt',
  'updatedAt',
  'receivedAt',
  'poCorrelative',
  'warehouseName',
  'contractName',
  'receivedByName',
] as const;

type WarehouseReceiptListSortField =
  (typeof WR_LIST_SORT_FIELDS)[number];

function isWarehouseReceiptListSortField(
  v: string,
): v is WarehouseReceiptListSortField {
  return (WR_LIST_SORT_FIELDS as readonly string[]).includes(v);
}

function parseWarehouseReceiptListSort(
  sort?: string,
  dir?: string,
): {
  field: WarehouseReceiptListSortField;
  order: 'asc' | 'desc';
} {
  const field: WarehouseReceiptListSortField =
    sort && isWarehouseReceiptListSortField(sort) ? sort : 'createdAt';
  if (dir === 'asc' || dir === 'desc') {
    return { field, order: dir };
  }
  if (
    field === 'createdAt' ||
    field === 'updatedAt' ||
    field === 'receivedAt'
  ) {
    return { field, order: 'desc' };
  }
  return { field, order: 'asc' };
}

function buildWarehouseReceiptListOrderBy(
  field: WarehouseReceiptListSortField,
  order: 'asc' | 'desc',
): Prisma.WarehouseReceiptOrderByWithRelationInput {
  switch (field) {
    case 'poCorrelative':
      return { purchaseOrder: { correlative: order } };
    case 'warehouseName':
      return { warehouse: { name: order } };
    case 'contractName':
      return { purchaseOrder: { contract: { name: order } } };
    case 'receivedByName':
      return { receivedBy: { name: order } };
    case 'correlative':
      return { correlative: order };
    case 'status':
      return { status: order };
    case 'createdAt':
      return { createdAt: order };
    case 'updatedAt':
      return { updatedAt: order };
    case 'receivedAt':
      return { receivedAt: order };
    default:
      return { createdAt: 'desc' };
  }
}

function calculateCPP(
  currentQty: number,
  currentUnitCost: number,
  receivedQty: number,
  incomingUnitCost: number,
): string {
  const cQ = new Decimal(currentQty);
  const cC = new Decimal(currentUnitCost || 0);
  const rQ = new Decimal(receivedQty);
  const rC = new Decimal(incomingUnitCost);
  const totalQty = cQ.plus(rQ);
  if (totalQty.isZero()) return rC.toFixed(4);
  return cQ.mul(cC).plus(rQ.mul(rC)).div(totalQty).toFixed(4);
}

const SUBCONTRACT_RECEIPT_SELECT = {
  select: { id: true, code: true, name: true },
} as const;

const RECEIPT_DETAIL_INCLUDE = {
  purchaseOrder: {
    select: {
      id: true,
      correlative: true,
      totalAmount: true,
      status: true,
      equipmentId: true,
      contract: { select: { id: true, code: true, name: true } },
      subcontract: SUBCONTRACT_RECEIPT_SELECT,
      equipment: EQUIPMENT_LINK_SELECT,
      workOrder: WORK_ORDER_LINK_SELECT,
    },
  },
  warehouse: { select: { id: true, code: true, name: true } },
  receivedBy: { select: { id: true, name: true } },
  items: {
    include: {
      orderItem: {
        include: {
          inventoryItem: {
            select: {
              id: true,
              partNumber: true,
              name: true,
              unitOfMeasure: {
                select: { id: true, name: true, abbreviation: true },
              },
              isInventory: true,
            },
          },
        },
      },
    },
  },
} as const;

@Injectable()
export class WarehouseReceiptsService {
  private readonly logger = new Logger(WarehouseReceiptsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sequenceService: SequenceService,
    private readonly audit: AuditService,
    private readonly inventoryStockService: InventoryStockService,
  ) {}

  private readonly overReceiptMessage =
    'No se puede recibir más de la cantidad pendiente en la Orden de Compra';

  private buildContractScope(user?: {
    role?: string;
    allowedContracts?: string[];
  }): Prisma.PurchaseOrderWhereInput {
    if (!user) return {};
    if (user.role === 'ADMIN' || user.role === 'SUPER_ADMIN') return {};
    const allowed = user.allowedContracts ?? [];
    if (allowed.includes('ALL')) return {};
    if (!allowed.length) {
      return { contractId: '00000000-0000-4000-8000-000000000000' };
    }
    return { contractId: { in: allowed } };
  }

  private receiptListSearchOr(
    term: string,
  ): Prisma.WarehouseReceiptWhereInput[] {
    const mode = 'insensitive' as const;
    const contains = (s: string): Prisma.StringFilter => ({
      contains: s,
      mode,
    });
    const clauses: Prisma.WarehouseReceiptWhereInput[] = [
      { correlative: contains(term) },
      { observations: contains(term) },
      {
        warehouse: {
          OR: [{ name: contains(term) }, { code: contains(term) }],
        },
      },
      { receivedBy: { name: contains(term) } },
      {
        purchaseOrder: {
          OR: [
            { correlative: contains(term) },
            {
              contract: {
                OR: [{ name: contains(term) }, { code: contains(term) }],
              },
            },
            {
              subcontract: {
                OR: [{ name: contains(term) }, { code: contains(term) }],
              },
            },
          ],
        },
      },
    ];
    if (isReceiptListUuid(term)) {
      clauses.unshift({ id: term });
    }
    return clauses;
  }

  private buildReceiptListWhere(
    tenantId: string,
    user?: { role?: string; allowedContracts?: string[] },
    search?: string,
  ): Prisma.WarehouseReceiptWhereInput {
    const poScope = this.buildContractScope(user);
    const searchTerm =
      typeof search === 'string'
        ? search.trim().slice(0, WR_LIST_SEARCH_MAX_LEN)
        : '';
    const searchOr = searchTerm ? this.receiptListSearchOr(searchTerm) : [];

    const and: Prisma.WarehouseReceiptWhereInput[] = [{ tenantId }];
    if (Object.keys(poScope).length > 0) {
      and.push({ purchaseOrder: poScope });
    }
    if (searchOr.length > 0) {
      and.push({ OR: searchOr });
    }
    if (and.length === 1) {
      return and[0] as Prisma.WarehouseReceiptWhereInput;
    }
    return { AND: and };
  }

  async findAll(
    tenantId: string,
    user?: { role?: string; allowedContracts?: string[] },
    opts?: {
      search?: string;
      page?: number;
      pageSize?: number;
      sort?: string;
      dir?: string;
    },
  ) {
    const pageSize = Math.min(
      WR_LIST_PAGE_SIZE_MAX,
      Math.max(1, Math.floor(opts?.pageSize ?? 25)),
    );
    const requestedPage = Math.max(1, Math.floor(opts?.page ?? 1));
    const { field: sortField, order: sortOrder } =
      parseWarehouseReceiptListSort(opts?.sort, opts?.dir);

    const where = this.buildReceiptListWhere(
      tenantId,
      user,
      opts?.search,
    );

    const total = await this.prisma.warehouseReceipt.count({ where });
    const maxPage = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(requestedPage, maxPage);
    const skip = (page - 1) * pageSize;

    const orderBy = buildWarehouseReceiptListOrderBy(sortField, sortOrder);

    const data = await this.prisma.warehouseReceipt.findMany({
      where,
      include: {
        purchaseOrder: {
          select: {
            id: true,
            correlative: true,
            totalAmount: true,
            contract: { select: { id: true, code: true, name: true } },
            subcontract: SUBCONTRACT_RECEIPT_SELECT,
          },
        },
        warehouse: { select: { id: true, code: true, name: true } },
        receivedBy: { select: { id: true, name: true } },
        _count: { select: { items: true } },
      },
      orderBy,
      skip,
      take: pageSize,
    });

    return { data, total, page, pageSize };
  }

  async findById(id: string, tenantId: string) {
    const receipt = await this.prisma.warehouseReceipt.findFirst({
      where: { id, tenantId },
      include: RECEIPT_DETAIL_INCLUDE,
    });
    if (!receipt) throw new NotFoundException('Recepción no encontrada');
    return this.attachQuantityPendingOnPurchase(receipt, tenantId);
  }

  /**
   * OC − cantidades ya registradas en **otras** recepciones de la misma OC
   * (todas las líneas `receipt_items`, cualquier estado), para UI y techo coherente con `updateItems`/`confirm`.
   */
  private async attachQuantityPendingOnPurchase<
    T extends {
      id: string;
      purchaseOrderId: string;
      items: Array<{
        orderItemId: string;
        orderItem: { quantity: unknown };
        [key: string]: unknown;
      }>;
    },
  >(receipt: T, tenantId: string): Promise<
    T & {
      items: Array<
        T['items'][number] & { quantityPendingOnPurchase: number }
      >;
    }
  > {
    const orderItemIds = receipt.items.map((i) => i.orderItemId);
    if (orderItemIds.length === 0) {
      return receipt as T & {
        items: Array<
          T['items'][number] & { quantityPendingOnPurchase: number }
        >;
      };
    }
    const sumsOther = await this.prisma.receiptItem.groupBy({
      by: ['orderItemId'],
      where: {
        orderItemId: { in: orderItemIds },
        receipt: {
          purchaseOrderId: receipt.purchaseOrderId,
          tenantId,
          id: { not: receipt.id },
        },
      },
      _sum: { quantityReceived: true },
    });
    const mapOther = new Map(
      sumsOther.map((s) => [
        s.orderItemId,
        Number(s._sum.quantityReceived ?? 0),
      ]),
    );
    const items = receipt.items.map((item) => {
      const orderQty = Number(item.orderItem.quantity);
      const receivedElsewhere = mapOther.get(item.orderItemId) ?? 0;
      const quantityPendingOnPurchase = Math.max(0, orderQty - receivedElsewhere);
      return { ...item, quantityPendingOnPurchase };
    });
    return { ...receipt, items };
  }

  async create(
    data: { purchaseOrderId: string; warehouseId: string },
    user: any,
  ) {
    const tenantId = user.tenantId;

    const receipt = await this.prisma.$transaction(async (tx) => {
      const order = await tx.purchaseOrder.findFirst({
        where: {
          id: data.purchaseOrderId,
          tenantId,
          status: { in: [...PO_STATUSES_ALLOW_WAREHOUSE_RECEIPT] },
        },
        include: { items: true },
      });

      if (!order) {
        throw new BadRequestException(
          'OC no encontrada o no está en estado válido para recepción. Debe marcar la orden como enviada al proveedor (estado SENT u ORDERED) o tener recepción en curso (parcial).',
        );
      }

      if (!order.items.length) {
        throw new BadRequestException(
          'La orden de compra no tiene líneas; no se puede registrar una recepción.',
        );
      }

      assertUserHasContractAccess(
        user,
        order.contractId,
        'No tiene acceso al contrato de esta orden de compra',
      );

      const warehouse = await tx.warehouse.findFirst({
        where: { id: data.warehouseId, tenantId },
      });
      if (!warehouse) throw new NotFoundException('Bodega no encontrada');

      if (warehouse.contractId !== order.contractId) {
        throw new BadRequestException(
          'La bodega de recepción no pertenece al mismo contrato de la orden de compra.',
        );
      }

      const correlative = await this.sequenceService.getNextCorrelative(
        tenantId,
        'WR',
        'WR',
        tx,
      );

      const orderItemIds = order.items.map((oi) => oi.id);
      const priorSums =
        orderItemIds.length === 0
          ? []
          : await tx.receiptItem.groupBy({
              by: ['orderItemId'],
              where: {
                orderItemId: { in: orderItemIds },
                receipt: { purchaseOrderId: order.id, tenantId },
              },
              _sum: { quantityReceived: true },
            });
      const priorReceivedByLine = new Map(
        priorSums.map((s) => [
          s.orderItemId,
          Number(s._sum.quantityReceived ?? 0),
        ]),
      );

      return tx.warehouseReceipt.create({
        data: {
          tenantId,
          purchaseOrderId: data.purchaseOrderId,
          warehouseId: data.warehouseId,
          receivedById: user.id,
          correlative,
          items: {
            create: order.items.map((oi) => {
              const already = priorReceivedByLine.get(oi.id) ?? 0;
              const pending = Math.max(0, Number(oi.quantity) - already);
              return {
                orderItemId: oi.id,
                quantityExpected: pending,
                quantityReceived: 0,
              };
            }),
          },
        },
        include: {
          warehouse: { select: { code: true, name: true } },
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

    await this.audit.log({
      userId: user.id,
      tenantId,
      entityType: 'PURCHASE_ORDER',
      entityId: data.purchaseOrderId,
      action: 'UPDATE',
      newValue: {
        event: 'warehouse_receipt_opened',
        receiptCorrelative: receipt.correlative,
        receiptId: receipt.id,
        warehouseName: receipt.warehouse.name,
        warehouseCode: receipt.warehouse.code,
      },
    });

    return receipt;
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

    if (receipt.status !== 'PENDING') {
      throw new BadRequestException(
        receipt.status === 'COMPLETED'
          ? 'Esta recepción ya fue confirmada.'
          : 'Esta recepción ya fue procesada; no se pueden modificar las cantidades.',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const targetIds = items.map((i) => i.id);
      const receiptLines = await tx.receiptItem.findMany({
        where: { receiptId, id: { in: targetIds } },
        select: {
          id: true,
          orderItemId: true,
          orderItem: { select: { quantity: true } },
        },
      });

      if (receiptLines.length !== targetIds.length) {
        throw new BadRequestException(
          'Una o más líneas de recepción no pertenecen al documento.',
        );
      }

      const incomingByOrderItem = new Map<string, number>();
      for (const line of receiptLines) {
        const incoming =
          items.find((i) => i.id === line.id)?.quantityReceived ?? 0;
        if (incoming < 0) {
          throw new BadRequestException(
            'La cantidad recibida no puede ser negativa.',
          );
        }
        incomingByOrderItem.set(
          line.orderItemId,
          (incomingByOrderItem.get(line.orderItemId) ?? 0) + Number(incoming),
        );
      }

      const orderItemIds = [...incomingByOrderItem.keys()];
      const receivedInOtherReceipts = await tx.receiptItem.groupBy({
        by: ['orderItemId'],
        where: {
          orderItemId: { in: orderItemIds },
          receipt: {
            purchaseOrderId: receipt.purchaseOrderId,
            tenantId: user.tenantId,
            id: { not: receiptId },
          },
        },
        _sum: { quantityReceived: true },
      });
      const receivedByOrderItem = new Map(
        receivedInOtherReceipts.map((r) => [
          r.orderItemId,
          Number(r._sum.quantityReceived ?? 0),
        ]),
      );

      for (const line of receiptLines) {
        const orderQty = Number(line.orderItem.quantity);
        const alreadyReceived = receivedByOrderItem.get(line.orderItemId) ?? 0;
        const pending = orderQty - alreadyReceived;
        const incoming = incomingByOrderItem.get(line.orderItemId) ?? 0;
        if (incoming - pending > 1e-9) {
          throw new BadRequestException(this.overReceiptMessage);
        }
      }

      const updates = [];
      for (const item of items) {
        updates.push(
          tx.receiptItem.update({
            where: { id: item.id },
            data: {
              quantityReceived: item.quantityReceived,
              observations: item.observations,
            },
          }),
        );
      }
      return Promise.all(updates);
    });
  }

  async confirm(receiptId: string, user: any) {
    const receipt = await this.findById(receiptId, user.tenantId);

    assertUserHasContractAccess(
      user,
      receipt.purchaseOrder.contract.id,
      'No tiene acceso al contrato de esta recepción',
    );

    if (receipt.status !== 'PENDING') {
      throw new BadRequestException(
        receipt.status === 'COMPLETED'
          ? 'Esta recepción ya fue confirmada.'
          : 'Esta recepción ya fue procesada; no se puede volver a confirmar.',
      );
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

    const prevPoStatus = receipt.purchaseOrder.status;

    let trackedCount = 0;
    let skippedNoLink = 0;
    let skippedDirectExpense = 0;

    await this.prisma.$transaction(
      async (tx) => {
        const warehouse = await tx.warehouse.findFirst({
          where: {
            id: receipt.warehouseId,
            tenantId: user.tenantId,
            isActive: true,
          },
        });
        if (!warehouse) {
          throw new BadRequestException(
            'La bodega de recepción no existe, no pertenece a su empresa o está inactiva. No se puede confirmar.',
          );
        }

        let allComplete = true;

        const orderItemIds = receipt.items.map((i) => i.orderItemId);
        const receivedInOtherReceipts = await tx.receiptItem.groupBy({
          by: ['orderItemId'],
          where: {
            orderItemId: { in: orderItemIds },
            receipt: {
              purchaseOrderId: receipt.purchaseOrderId,
              tenantId: user.tenantId,
              id: { not: receiptId },
            },
          },
          _sum: { quantityReceived: true },
        });
        const receivedByOrderItem = new Map(
          receivedInOtherReceipts.map((r) => [
            r.orderItemId,
            Number(r._sum.quantityReceived ?? 0),
          ]),
        );

        for (const item of receipt.items) {
          const orderQty = Number(item.orderItem.quantity);
          const alreadyReceived =
            receivedByOrderItem.get(item.orderItemId) ?? 0;
          const pending = orderQty - alreadyReceived;
          if (Number(item.quantityReceived) - pending > 1e-9) {
            throw new BadRequestException(this.overReceiptMessage);
          }

          if (item.quantityReceived <= 0) continue;

          const inventoryItemId = item.orderItem.inventoryItemId;
          const inventoryItem = item.orderItem.inventoryItem;

          if (!inventoryItemId) {
            skippedNoLink++;
            if (item.quantityReceived < item.quantityExpected)
              allComplete = false;
            continue;
          }

          if (!inventoryItem?.isInventory) {
            skippedDirectExpense++;
            if (item.quantityReceived < item.quantityExpected)
              allComplete = false;
            continue;
          }

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
          const incomingCost = Number(item.orderItem.unitCost);

          const newUnitCost = calculateCPP(
            previousStock,
            Number(existingStock?.unitCost ?? 0),
            item.quantityReceived,
            incomingCost,
          );

          const policyDefaults = !existingStock
            ? await getPolicyThresholdsForNewItemStockRow(
                tx,
                user.tenantId,
                inventoryItemId,
                receipt.warehouseId,
              )
            : { minStock: 0, maxStock: 0 };

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
              unitCost: incomingCost,
              minStock: policyDefaults.minStock,
              maxStock: policyDefaults.maxStock,
            },
            update: {
              quantity: { increment: item.quantityReceived },
              unitCost: parseFloat(newUnitCost),
            },
          });

          await clearItemStockPolicyIfMatchesWarehouse(
            tx,
            user.tenantId,
            inventoryItemId,
            receipt.warehouseId,
          );

          await tx.inventoryTransaction.create({
            data: {
              warehouseId: receipt.warehouseId,
              itemId: inventoryItemId,
              userId: user.id,
              type: 'PURCHASE_RECEIPT',
              quantity: item.quantityReceived,
              previousStock,
              newStock,
              referenceId: receipt.id,
              referenceType: 'PURCHASE_RECEIPT',
              notes: item.observations
                ? `Recepción ${receipt.correlative} (OC ${receipt.purchaseOrder.correlative}): ${item.observations}`
                : `Recepción ${receipt.correlative} (OC ${receipt.purchaseOrder.correlative})`,
            },
          });

          await this.inventoryStockService.clearPendingRegularizationFlags(
            tx,
            receipt.warehouseId,
            inventoryItemId,
            newStock,
          );

          trackedCount++;

          if (item.quantityReceived < item.quantityExpected) {
            allComplete = false;
          }
        }

        const equipmentId = receipt.purchaseOrder.equipmentId;
        if (equipmentId) {
          let imputed = new Decimal(0);
          for (const line of receipt.items) {
            if (line.quantityReceived <= 0) continue;
            const unit = new Decimal(line.orderItem.unitCost.toString());
            const qty = new Decimal(line.quantityReceived);
            imputed = imputed.plus(unit.mul(qty));
          }
          if (imputed.greaterThan(0)) {
            await tx.assetCostRecord.create({
              data: {
                tenantId: user.tenantId,
                equipmentId,
                amount: imputed.toFixed(2),
                type: 'PURCHASE',
                purchaseOrderId: receipt.purchaseOrderId,
                warehouseReceiptId: receiptId,
                recordedAt: new Date(),
              },
            });
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
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10_000,
        timeout: 60_000,
      },
    );

    const refreshed = await this.findById(receiptId, user.tenantId);
    await this.audit.log({
      userId: user.id,
      tenantId: user.tenantId,
      entityType: 'PURCHASE_ORDER',
      entityId: receipt.purchaseOrderId,
      action: 'STATUS_CHANGE',
      oldValue: { status: prevPoStatus },
      newValue: {
        status: refreshed.purchaseOrder.status,
        receiptCorrelative: refreshed.correlative,
        event: 'warehouse_receipt_confirmed',
        stockTrackedItems: trackedCount,
        stockSkippedItems: skippedNoLink,
        directExpenseItems: skippedDirectExpense,
      },
    });

    const poLink = await this.prisma.purchaseOrder.findFirst({
      where: { id: receipt.purchaseOrderId, tenantId: user.tenantId },
      select: {
        requisitionId: true,
        quotation: { select: { requisitionId: true } },
      },
    });
    const reqId = requisitionIdFromPurchaseOrder(poLink);
    if (reqId) {
      const actorId = user.id || user.sub;
      if (actorId) {
        void tryAutoCloseRequisitionIfFullyReconciled(
          this.prisma,
          user.tenantId,
          reqId,
          String(actorId),
        ).catch((e) =>
          this.logger.warn(
            `Auto-cierre SRC tras recepción de bodega: ${String(e)}`,
          ),
        );
      }
    }

    const skippedTotal = skippedNoLink + skippedDirectExpense;
    const messages: string[] = [];
    if (skippedNoLink > 0)
      messages.push(
        `${skippedNoLink} ítem(s) sin vínculo al catálogo (sin stock).`,
      );
    if (skippedDirectExpense > 0)
      messages.push(
        `${skippedDirectExpense} ítem(s) marcado(s) como Gasto Directo (isInventory=false).`,
      );

    return {
      ...refreshed,
      stockSummary: {
        trackedItems: trackedCount,
        skippedItems: skippedTotal,
        skippedNoLink,
        directExpenseItems: skippedDirectExpense,
        message: messages.length > 0 ? messages.join(' ') : null,
      },
    };
  }
}
