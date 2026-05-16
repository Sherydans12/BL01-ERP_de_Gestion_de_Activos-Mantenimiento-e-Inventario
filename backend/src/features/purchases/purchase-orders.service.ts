import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { Readable } from 'stream';
import { PrismaService } from '../../prisma/prisma.service';
import { PO_STATUSES_ALLOW_WAREHOUSE_RECEIPT } from './po-receipt-eligible-statuses';
import { SequenceService } from '../../common/sequence/sequence.service';
import {
  generateSignatureHash,
  verifySignatureIntegrity,
  SignaturePayload,
} from '../../common/crypto/signature.util';
import { AuditService, pickChanged } from '../../common/audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { resolveApprovalPolicyForUser } from '../tenant-roles/tenant-role-defaults';
import {
  EQUIPMENT_LINK_SELECT,
  WORK_ORDER_LINK_SELECT,
} from './purchase-asset-links.include';
import { generatePurchaseOrderPdfBuffer } from './purchase-order-pdf.generator';
import { assertUserHasContractAccess } from './purchase-contract-access.util';
import { syncPurchaseQuotationStatusesFromLineAwards } from './purchase-quotation-status-sync.util';
import {
  ActivityAction,
  Prisma,
  PurchaseOrderStatus,
} from '@prisma/client';
import type { QuotationStatusChange } from './purchase-quotation-status-sync.util';
import { EmailService } from '../../common/email/email.service';
import { StorageService } from '../../common/storage/storage.service';

const SUBCONTRACT_SELECT = {
  select: { id: true, code: true, name: true },
} as const;

/** OC que no bloquean nueva compra / re-adjudicación de líneas. */
const PO_INACTIVE_STATUSES: PurchaseOrderStatus[] = ['CANCELLED', 'REJECTED'];

@Injectable()
export class PurchaseOrdersService {
  private readonly logger = new Logger(PurchaseOrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sequenceService: SequenceService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly emailService: EmailService,
    private readonly storage: StorageService,
  ) {}

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

  async findAll(
    tenantId: string,
    status?: string,
    user?: { role?: string; allowedContracts?: string[] },
  ) {
    const contractFilter = this.buildContractScope(user);
    return this.prisma.purchaseOrder.findMany({
      where: {
        tenantId,
        ...(status && { status: status as any }),
        ...contractFilter,
      },
      include: {
        contract: { select: { id: true, code: true, name: true } },
        subcontract: SUBCONTRACT_SELECT,
        quotation: {
          select: {
            id: true,
            vendor: { select: { id: true, name: true, code: true } },
          },
        },
        _count: { select: { approvals: true, items: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** OCs en las que se puede abrir recepción de bodega (mismo criterio que WarehouseReceiptsService.create). */
  async findEligibleForWarehouseReceipt(
    tenantId: string,
    user?: { role?: string; allowedContracts?: string[] },
  ) {
    const contractFilter = this.buildContractScope(user);
    return this.prisma.purchaseOrder.findMany({
      where: {
        tenantId,
        status: { in: [...PO_STATUSES_ALLOW_WAREHOUSE_RECEIPT] },
        ...contractFilter,
      },
      include: {
        contract: { select: { id: true, code: true, name: true } },
        subcontract: SUBCONTRACT_SELECT,
        quotation: {
          select: {
            id: true,
            vendor: { select: { id: true, name: true, code: true } },
          },
        },
        _count: { select: { approvals: true, items: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(
    id: string,
    tenantId: string,
    user?: { role?: string; allowedContracts?: string[] },
  ) {
    const order = await this.prisma.purchaseOrder.findFirst({
      where: { id, tenantId },
      include: {
        contract: { select: { id: true, code: true, name: true } },
        subcontract: SUBCONTRACT_SELECT,
        equipment: EQUIPMENT_LINK_SELECT,
        workOrder: WORK_ORDER_LINK_SELECT,
        quotation: {
          include: {
            vendor: {
              select: {
                id: true,
                name: true,
                code: true,
                rut: true,
                address: true,
                contactPhone: true,
              },
            },
            items: true,
            requisition: {
              include: {
                quotations: {
                  include: {
                    vendor: { select: { id: true, name: true, code: true } },
                  },
                  orderBy: { createdAt: 'desc' },
                },
              },
            },
          },
        },
        items: {
          include: {
            inventoryItem: {
              select: {
                id: true,
                partNumber: true,
                name: true,
                isInventory: true,
              },
            },
          },
        },
        approvals: {
          include: {
            policy: { select: { id: true, level: true, description: true } },
            approvedBy: { select: { id: true, name: true, email: true } },
          },
          orderBy: { level: 'asc' },
        },
        purchaseInvoice: {
          include: {
            vendor: { select: { id: true, name: true, code: true } },
          },
        },
        receipts: {
          include: {
            warehouse: {
              select: { id: true, code: true, name: true, location: true },
            },
            items: {
              include: {
                orderItem: {
                  select: {
                    id: true,
                    unitCost: true,
                    quantity: true,
                    description: true,
                  },
                },
              },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!order) throw new NotFoundException('Orden de compra no encontrada');

    if (user) {
      assertUserHasContractAccess(user, order.contractId);
    }

    const enrichedApprovals = order.approvals.map((approval) => {
      const payload: SignaturePayload = {
        userId: approval.approvedById,
        orderId: order.id,
        totalAmount: order.totalAmount.toString(),
        status: approval.hashedStatus ?? order.status,
        timestamp: approval.approvedAt.toISOString(),
        tenantId: order.tenantId,
      };

      const isValid = verifySignatureIntegrity(approval.signatureHash, payload);

      if (!isValid && approval.integrityStatus === 'VALID') {
        this.prisma.purchaseOrderApproval
          .update({
            where: { id: approval.id },
            data: { integrityStatus: 'COMPROMISED' },
          })
          .catch(() => {});
      }

      return {
        ...approval,
        integrityStatus: isValid ? 'VALID' : 'COMPROMISED',
      };
    });

    const [poDocuments, invoiceDocuments] = await Promise.all([
      this.prisma.purchaseDocument.findMany({
        where: { tenantId, entity: 'PURCHASE_ORDER', entityId: id },
        orderBy: { createdAt: 'desc' },
        include: {
          uploadedBy: { select: { id: true, name: true, email: true } },
        },
      }),
      order.purchaseInvoice
        ? this.prisma.purchaseDocument.findMany({
            where: {
              tenantId,
              entity: 'PURCHASE_INVOICE',
              entityId: order.purchaseInvoice.id,
            },
            orderBy: { createdAt: 'desc' },
            include: {
              uploadedBy: { select: { id: true, name: true, email: true } },
            },
          })
        : Promise.resolve([]),
    ]);

    const resolvedQuotation = order.quotation
      ? {
          ...order.quotation,
          attachmentUrl: order.quotation.attachmentUrl
            ? await this.storage.getReadOnlyUrl(order.quotation.attachmentUrl)
            : null,
          requisition: order.quotation.requisition
            ? {
                ...order.quotation.requisition,
                quotations: await Promise.all(
                  order.quotation.requisition.quotations.map(async (q) => ({
                    ...q,
                    attachmentUrl: q.attachmentUrl
                      ? await this.storage.getReadOnlyUrl(q.attachmentUrl)
                      : null,
                  })),
                ),
              }
            : null,
        }
      : null;

    return {
      ...order,
      quotation: resolvedQuotation,
      approvals: enrichedApprovals,
      purchaseDocuments: poDocuments,
      purchaseInvoice: order.purchaseInvoice
        ? {
            ...order.purchaseInvoice,
            pdfUrl: order.purchaseInvoice.pdfUrl
              ? await this.storage.getReadOnlyUrl(order.purchaseInvoice.pdfUrl)
              : null,
            purchaseDocuments: invoiceDocuments,
          }
        : null,
    };
  }

  /**
   * Vincula una línea de OC (texto libre) a un artículo del catálogo. Solo permitido antes de la aprobación final.
   */
  async linkItemToCatalog(
    orderId: string,
    orderItemId: string,
    inventoryItemId: string,
    user: {
      id: string;
      tenantId: string;
      role?: string;
      allowedContracts?: string[];
    },
  ) {
    const allowedStatuses = [
      'DRAFT',
      'PENDING_APPROVAL',
      'PARTIALLY_APPROVED',
    ] as const;

    const order = await this.prisma.purchaseOrder.findFirst({
      where: { id: orderId, tenantId: user.tenantId },
    });
    if (!order) throw new NotFoundException('Orden de compra no encontrada');
    assertUserHasContractAccess(user, order.contractId);

    if (
      !allowedStatuses.includes(
        order.status as (typeof allowedStatuses)[number],
      )
    ) {
      throw new BadRequestException(
        'Solo se puede vincular al catálogo mientras la OC está en borrador o pendiente de aprobación (no aplica tras aprobación o envío).',
      );
    }

    const line = await this.prisma.purchaseOrderItem.findFirst({
      where: { id: orderItemId, purchaseOrderId: orderId },
    });
    if (!line) throw new NotFoundException('Línea de orden no encontrada');

    if (line.inventoryItemId) {
      throw new BadRequestException(
        'Esta línea ya está vinculada a un artículo de catálogo.',
      );
    }

    const catalogItem = await this.prisma.inventoryItem.findFirst({
      where: { id: inventoryItemId, tenantId: user.tenantId },
    });
    if (!catalogItem) {
      throw new NotFoundException('Artículo de inventario no encontrado');
    }

    await this.prisma.purchaseOrderItem.update({
      where: { id: orderItemId },
      data: { inventoryItemId },
    });

    await this.audit.log({
      userId: user.id,
      tenantId: user.tenantId,
      entityType: 'PURCHASE_ORDER',
      entityId: orderId,
      action: ActivityAction.SYSTEM_UPDATE,
      newValue: {
        message: `Ítem vinculado al catálogo: ${catalogItem.name}`,
        catalogItemName: catalogItem.name,
        orderItemId,
        inventoryItemId,
      },
    });

    return this.findById(orderId, user.tenantId, user);
  }

  /**
   * Historial de auditoría para la OC: eventos de la propia orden y del requerimiento vinculado (si existe).
   */
  async findActivityLogs(orderId: string, tenantId: string) {
    const order = await this.prisma.purchaseOrder.findFirst({
      where: { id: orderId, tenantId },
      select: {
        id: true,
        requisitionId: true,
        quotation: { select: { requisitionId: true } },
      },
    });
    if (!order) throw new NotFoundException('Orden de compra no encontrada');

    const requisitionId =
      order.requisitionId ?? order.quotation?.requisitionId ?? undefined;
    const invoice = await this.prisma.purchaseInvoice.findUnique({
      where: { purchaseOrderId: orderId },
      select: { id: true },
    });

    const orFilter: Prisma.ActivityLogWhereInput[] = requisitionId
      ? [
          { entityType: 'PURCHASE_ORDER', entityId: orderId },
          { entityType: 'REQUISITION', entityId: requisitionId },
        ]
      : [{ entityType: 'PURCHASE_ORDER', entityId: orderId }];

    if (invoice) {
      orFilter.push({
        entityType: 'PURCHASE_INVOICE',
        entityId: invoice.id,
      });
    }

    orFilter.push({
      entityType: 'PURCHASE_INVOICE',
      details: {
        path: ['metadata', 'purchaseOrderId'],
        equals: orderId,
      },
    });

    return this.prisma.activityLog.findMany({
      where: {
        tenantId,
        OR: orFilter,
      },
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
    });
  }

  /** Dirección de entrega y condición de pago (campos operativos; no modifican firmas ni montos). */
  async updateOrderLogistics(
    orderId: string,
    data: {
      deliveryAddress?: string | null;
      paymentTerms?: string | null;
    },
    user: { tenantId: string; role?: string; allowedContracts?: string[] },
  ) {
    const tenantId = user.tenantId;
    const order = await this.prisma.purchaseOrder.findFirst({
      where: { id: orderId, tenantId },
      select: { id: true, contractId: true },
    });
    if (!order) throw new NotFoundException('Orden de compra no encontrada');
    assertUserHasContractAccess(
      user,
      order.contractId,
      'No tiene acceso al contrato de esta orden de compra',
    );

    const hasChange =
      data.deliveryAddress !== undefined || data.paymentTerms !== undefined;
    if (!hasChange) {
      throw new BadRequestException('No se recibieron campos para actualizar.');
    }

    const updateData: Prisma.PurchaseOrderUpdateInput = {};
    if (data.deliveryAddress !== undefined) {
      updateData.deliveryAddress = data.deliveryAddress;
    }
    if (data.paymentTerms !== undefined) {
      updateData.paymentTerms = data.paymentTerms;
    }

    await this.prisma.purchaseOrder.update({
      where: { id: orderId },
      data: updateData,
    });

    return this.findById(orderId, tenantId, user);
  }

  /**
   * PDF de la OC generado al vuelo (incluye equipo / OT para trazabilidad operativa).
   */
  async getPurchaseOrderPdfStream(
    id: string,
    tenantId: string,
  ): Promise<Readable> {
    const order = await this.prisma.purchaseOrder.findFirst({
      where: { id, tenantId },
      include: {
        contract: { select: { id: true, code: true, name: true } },
        subcontract: SUBCONTRACT_SELECT,
        equipment: EQUIPMENT_LINK_SELECT,
        workOrder: WORK_ORDER_LINK_SELECT,
        quotation: {
          include: {
            vendor: { select: { id: true, code: true, name: true } },
          },
        },
        items: {
          include: {
            inventoryItem: {
              select: { id: true, partNumber: true, name: true },
            },
          },
        },
      },
    });

    if (!order) {
      throw new NotFoundException('Orden de compra no encontrada');
    }

    const buffer = await generatePurchaseOrderPdfBuffer(order);
    return Readable.from(buffer);
  }

  /**
   * Ajusta estado del requerimiento según cobertura de OC por líneas adjudicadas.
   * Base por OC (sin IVA); impuestos se liquidan por factura asociada a cada OC.
   */
  private async applyRequisitionCoverageStatusAfterPurchase(
    tx: Prisma.TransactionClient,
    requisitionId: string,
  ) {
    const items = await tx.requisitionItem.findMany({
      where: { requisitionId },
      select: { awardedQuotationItemId: true },
    });
    if (!items.length) return;
    const allHaveAward = items.every((i) => i.awardedQuotationItemId != null);
    const awardIds = items
      .map((i) => i.awardedQuotationItemId)
      .filter((id): id is string => id != null);
    const sourced =
      awardIds.length === 0
        ? []
        : await tx.purchaseOrderItem.findMany({
            where: {
              sourceQuotationItemId: { in: awardIds },
              purchaseOrder: {
                requisitionId,
                status: { notIn: PO_INACTIVE_STATUSES },
              },
            },
            select: { sourceQuotationItemId: true },
          });
    const bought = new Set(
      sourced.map((s) => s.sourceQuotationItemId).filter(Boolean) as string[],
    );
    const everyLinePurchased = items.every(
      (i) =>
        i.awardedQuotationItemId != null &&
        bought.has(i.awardedQuotationItemId),
    );
    const anyPurchased = items.some(
      (i) =>
        i.awardedQuotationItemId != null &&
        bought.has(i.awardedQuotationItemId),
    );
    let next: 'APPROVED' | 'PARTIALLY_PURCHASED' | 'PENDING_APPROVAL' | null =
      null;
    if (allHaveAward && everyLinePurchased) next = 'APPROVED';
    else if (anyPurchased) next = 'PARTIALLY_PURCHASED';
    else if (allHaveAward && !anyPurchased) {
      /** Adjudicación persistida pero sin OC activa que cubra esas líneas (p. ej. tras anular OC). */
      next = 'PENDING_APPROVAL';
    } else if (!allHaveAward && !anyPurchased) {
      const reqRow = await tx.purchaseRequisition.findFirst({
        where: { id: requisitionId },
        select: { status: true },
      });
      if (
        reqRow?.status === 'APPROVED' ||
        reqRow?.status === 'PARTIALLY_PURCHASED'
      ) {
        next = 'PENDING_APPROVAL';
      }
    }
    if (next) {
      await tx.purchaseRequisition.update({
        where: { id: requisitionId },
        data: { status: next },
      });
    }
  }

  /**
   * Split multiproveedor: crea N órdenes en una transacción, agrupando por cotización.
   * Idempotente por línea (`sourceQuotationItemId` + OC activa del mismo requerimiento).
   */
  async createOrdersFromRequisition(requisitionId: string, user: any) {
    const tenantId = user.tenantId;

    let quotationStatusChanges: QuotationStatusChange[] = [];

    const result = await this.prisma.$transaction(async (tx) => {
      const requisition = await tx.purchaseRequisition.findFirst({
        where: { id: requisitionId, tenantId },
        include: { items: true },
      });
      if (!requisition) {
        throw new NotFoundException('Requerimiento no encontrado');
      }

      assertUserHasContractAccess(
        user,
        requisition.contractId,
        'No tiene acceso al contrato del requerimiento para generar órdenes de compra',
      );

      if (
        ![
          'QUOTING',
          'PENDING_APPROVAL',
          'PARTIALLY_PURCHASED',
          'APPROVED',
        ].includes(requisition.status)
      ) {
        throw new BadRequestException(
          'Solo se pueden generar OC desde requerimientos en cotización, pendientes de aprobación, parcialmente comprados o aprobados con líneas adjudicadas pendientes de OC',
        );
      }

      const awardIds = requisition.items
        .map((i) => i.awardedQuotationItemId)
        .filter((id): id is string => id != null);
      if (!awardIds.length) {
        throw new BadRequestException(
          'No hay líneas adjudicadas; guarde la adjudicación antes de generar órdenes de compra',
        );
      }

      const alreadyPurchasedRows = await tx.purchaseOrderItem.findMany({
        where: {
          sourceQuotationItemId: { in: awardIds },
          purchaseOrder: {
            tenantId,
            requisitionId,
            status: { notIn: PO_INACTIVE_STATUSES },
          },
        },
        select: { sourceQuotationItemId: true },
      });
      const alreadyPurchased = new Set(
        alreadyPurchasedRows
          .map((r) => r.sourceQuotationItemId)
          .filter(Boolean) as string[],
      );

      const pendingAwardIds = awardIds.filter(
        (id) => !alreadyPurchased.has(id),
      );
      if (!pendingAwardIds.length) {
        const statusBefore = requisition.status;
        await this.applyRequisitionCoverageStatusAfterPurchase(
          tx,
          requisitionId,
        );
        quotationStatusChanges =
          await syncPurchaseQuotationStatusesFromLineAwards(tx, requisitionId);
        const refreshed = await tx.purchaseRequisition.findFirst({
          where: { id: requisitionId },
          select: { status: true },
        });
        return {
          orders: [],
          requisitionStatusBefore: statusBefore,
          requisitionStatusAfter: refreshed?.status ?? statusBefore,
          requisitionId,
          idempotent: true as const,
        };
      }

      const quotationItems = await tx.quotationItem.findMany({
        where: {
          id: { in: pendingAwardIds },
          quotation: { requisitionId, tenantId },
        },
        include: {
          requisitionItem: true,
          quotation: { include: { requisition: true } },
        },
      });
      if (quotationItems.length !== pendingAwardIds.length) {
        throw new BadRequestException(
          'Una o más líneas adjudicadas no pertenecen a cotizaciones de este requerimiento',
        );
      }

      const groups = new Map<string, typeof quotationItems>();
      for (const qi of quotationItems) {
        const list = groups.get(qi.quotationId) ?? [];
        list.push(qi);
        groups.set(qi.quotationId, list);
      }

      const settings = await tx.purchaseSettings.findUnique({
        where: { tenantId },
      });
      const threshold = settings ? Number(settings.approvalThreshold) : 0;

      let resolvedEquipmentId = requisition.equipmentId ?? undefined;
      const resolvedWorkOrderId = requisition.workOrderId ?? undefined;
      if (resolvedWorkOrderId) {
        const wo = await tx.workOrder.findFirst({
          where: { id: resolvedWorkOrderId, tenantId },
          select: { equipmentId: true },
        });
        if (!wo) {
          throw new BadRequestException(
            'La orden de trabajo vinculada al requerimiento ya no existe',
          );
        }
        if (wo.equipmentId !== (resolvedEquipmentId ?? null)) {
          this.logger.warn(
            `OT ${resolvedWorkOrderId}: equipmentId cambió de ${resolvedEquipmentId} a ${wo.equipmentId}. Re-sincronizando OC.`,
          );
          resolvedEquipmentId = wo.equipmentId ?? undefined;
        }
      }

      const requisitionStatusBefore = requisition.status;
      const createdOrders: Awaited<
        ReturnType<typeof tx.purchaseOrder.create>
      >[] = [];

      for (const [, group] of groups) {
        const first = group[0];
        const quotation = first.quotation;
        let total = new Prisma.Decimal(0);
        for (const qi of group) {
          total = total.add(
            new Prisma.Decimal(qi.unitPrice).mul(qi.requisitionItem.quantity),
          );
        }
        const totalNum = Number(total);
        const requiredSignatures =
          totalNum >= threshold && threshold > 0 ? 3 : 2;

        const correlative = await this.sequenceService.getNextCorrelative(
          tenantId,
          'OC',
          'OC',
          tx,
        );

        const created = await tx.purchaseOrder.create({
          data: {
            tenantId,
            contractId: requisition.contractId,
            subcontractId: requisition.subcontractId ?? undefined,
            requisitionId,
            quotationId: quotation.id,
            correlative,
            status: 'PENDING_APPROVAL',
            totalAmount: total,
            currency: quotation.currency,
            requiredSignatures,
            equipmentId: resolvedEquipmentId,
            workOrderId: resolvedWorkOrderId,
            items: {
              create: group.map((qi) => ({
                description: qi.requisitionItem.description,
                quantity: qi.requisitionItem.quantity,
                unitCost: qi.unitPrice,
                inventoryItemId: qi.requisitionItem.inventoryItemId,
                sourceQuotationItemId: qi.id,
              })),
            },
          },
          include: {
            items: true,
            equipment: EQUIPMENT_LINK_SELECT,
            workOrder: WORK_ORDER_LINK_SELECT,
          },
        });
        createdOrders.push(created);
      }

      await this.applyRequisitionCoverageStatusAfterPurchase(tx, requisitionId);
      quotationStatusChanges =
        await syncPurchaseQuotationStatusesFromLineAwards(tx, requisitionId);
      const refreshed = await tx.purchaseRequisition.findFirst({
        where: { id: requisitionId },
        select: { status: true },
      });

      return {
        orders: createdOrders,
        requisitionStatusBefore,
        requisitionStatusAfter: refreshed?.status ?? requisition.status,
        requisitionId,
        idempotent: false as const,
      };
    });

    if (result.orders.length > 0) {
      await this.audit.logMany(
        result.orders.map((o) => ({
          userId: user.id,
          tenantId,
          entityType: 'PURCHASE_ORDER',
          entityId: o.id,
          action: ActivityAction.CREATE,
          newValue: {
            correlative: o.correlative,
            totalAmount: Number(o.totalAmount),
            status: o.status,
            event: 'split_po_from_requisition',
            requisitionId: result.requisitionId,
          },
        })),
      );
    }

    if (result.orders.length > 0) {
      const [reqRow, poVendors] = await Promise.all([
        this.prisma.purchaseRequisition.findFirst({
          where: { id: result.requisitionId, tenantId },
          select: { correlative: true },
        }),
        this.prisma.purchaseOrder.findMany({
          where: { id: { in: result.orders.map((o) => o.id) }, tenantId },
          select: {
            quotation: { select: { vendor: { select: { name: true } } } },
          },
        }),
      ]);
      const vendorNames = [
        ...new Set(
          poVendors
            .map((p) => p.quotation?.vendor?.name?.trim())
            .filter((n): n is string => !!n && n.length > 0),
        ),
      ];
      void this.notifyApproversForPendingSignatureBatch(
        tenantId,
        result.orders.map((o) => o.id),
        {
          requisitionCorrelative: reqRow?.correlative ?? result.requisitionId,
          vendorNames,
        },
      ).catch((err) =>
        this.logger.warn(
          `No se pudo enviar notificación resumen de OC (split): ${err}`,
        ),
      );
    }

    if (quotationStatusChanges.length) {
      await this.audit.log({
        userId: user.id,
        tenantId,
        entityType: 'REQUISITION',
        entityId: result.requisitionId,
        action: 'UPDATE',
        newValue: {
          event: 'quotation_statuses_synced',
          changes: quotationStatusChanges,
        },
      });
    }

    if (
      result.requisitionStatusBefore !== result.requisitionStatusAfter ||
      (!result.idempotent && result.orders.length > 0)
    ) {
      const correlatives = result.orders.map((o) => o.correlative);
      await this.audit.log({
        userId: user.id,
        tenantId,
        entityType: 'REQUISITION',
        entityId: result.requisitionId,
        action: 'STATUS_CHANGE',
        oldValue: { status: result.requisitionStatusBefore },
        newValue: {
          status: result.requisitionStatusAfter,
          event: result.idempotent
            ? 'split_po_idempotent_no_new_orders'
            : 'split_po_orders_created',
          purchaseOrderIds: result.orders.map((o) => o.id),
          orderCorrelatives: correlatives,
          message:
            correlatives.length > 0
              ? `Se generaron las órdenes de compra: ${correlatives.join(', ')}.`
              : undefined,
        },
      });
    }

    return {
      orders: result.orders,
      requisitionStatus: result.requisitionStatusAfter,
      idempotent: result.idempotent,
    };
  }

  async createFromQuotation(quotationId: string, user: any) {
    const tenantId = user.tenantId;

    const result = await this.prisma.$transaction(async (tx) => {
      const quotation = await tx.purchaseQuotation.findFirst({
        where: { id: quotationId, tenantId, isWinner: true },
        include: {
          items: { include: { requisitionItem: true } },
          requisition: true,
        },
      });

      if (!quotation) {
        throw new NotFoundException('Cotización ganadora no encontrada');
      }

      assertUserHasContractAccess(
        user,
        quotation.requisition.contractId,
        'No tiene acceso al contrato del requerimiento para generar esta OC',
      );

      const existingPO = await tx.purchaseOrder.findFirst({
        where: {
          quotationId,
          tenantId,
          status: { notIn: PO_INACTIVE_STATUSES },
        },
      });
      if (existingPO) {
        throw new ConflictException(
          'Ya existe una OC activa para esta cotización',
        );
      }

      let resolvedEquipmentId = quotation.requisition.equipmentId ?? undefined;
      const resolvedWorkOrderId =
        quotation.requisition.workOrderId ?? undefined;

      if (resolvedWorkOrderId) {
        const wo = await tx.workOrder.findFirst({
          where: { id: resolvedWorkOrderId, tenantId },
          select: { equipmentId: true, status: true },
        });
        if (!wo) {
          throw new BadRequestException(
            'La orden de trabajo vinculada al requerimiento ya no existe',
          );
        }
        if (wo.equipmentId !== (resolvedEquipmentId ?? null)) {
          this.logger.warn(
            `OT ${resolvedWorkOrderId}: equipmentId cambió de ${resolvedEquipmentId} a ${wo.equipmentId}. Re-sincronizando OC.`,
          );
          resolvedEquipmentId = wo.equipmentId ?? undefined;
        }
      }

      const requisitionStatusBefore = quotation.requisition.status;

      const settings = await tx.purchaseSettings.findUnique({
        where: { tenantId },
      });
      const threshold = settings ? Number(settings.approvalThreshold) : 0;
      const totalAmount = Number(quotation.totalAmount);
      const requiredSignatures =
        totalAmount >= threshold && threshold > 0 ? 3 : 2;

      const correlative = await this.sequenceService.getNextCorrelative(
        tenantId,
        'OC',
        'OC',
        tx,
      );

      const created = await tx.purchaseOrder.create({
        data: {
          tenantId,
          contractId: quotation.requisition.contractId,
          subcontractId: quotation.requisition.subcontractId ?? undefined,
          requisitionId: quotation.requisitionId,
          quotationId,
          correlative,
          status: 'PENDING_APPROVAL',
          totalAmount: quotation.totalAmount,
          currency: quotation.currency,
          requiredSignatures,
          equipmentId: resolvedEquipmentId,
          workOrderId: resolvedWorkOrderId,
          items: {
            create: quotation.items.map((qi) => ({
              description: qi.requisitionItem.description,
              quantity: qi.requisitionItem.quantity,
              unitCost: qi.unitPrice,
              inventoryItemId: qi.requisitionItem.inventoryItemId,
              sourceQuotationItemId: qi.id,
            })),
          },
        },
        include: {
          items: true,
          equipment: EQUIPMENT_LINK_SELECT,
          workOrder: WORK_ORDER_LINK_SELECT,
        },
      });

      for (const qi of quotation.items) {
        await tx.requisitionItem.update({
          where: { id: qi.requisitionItemId },
          data: { awardedQuotationItemId: qi.id },
        });
      }

      const quotationStatusChanges =
        await syncPurchaseQuotationStatusesFromLineAwards(
          tx,
          quotation.requisitionId,
        );

      await this.applyRequisitionCoverageStatusAfterPurchase(
        tx,
        quotation.requisitionId,
      );

      const refreshed = await tx.purchaseRequisition.findFirst({
        where: { id: quotation.requisitionId },
        select: { status: true },
      });

      return {
        order: created,
        requisitionStatusBefore,
        requisitionStatusAfter: refreshed?.status ?? 'APPROVED',
        requisitionId: quotation.requisitionId,
        quotationStatusChanges,
      };
    });

    await this.audit.log({
      userId: user.id,
      tenantId,
      entityType: 'PURCHASE_ORDER',
      entityId: result.order.id,
      action: 'CREATE',
      newValue: {
        correlative: result.order.correlative,
        totalAmount: Number(result.order.totalAmount),
        status: result.order.status,
      },
    });
    await this.audit.log({
      userId: user.id,
      tenantId,
      entityType: 'REQUISITION',
      entityId: result.requisitionId,
      action: 'STATUS_CHANGE',
      oldValue: { status: result.requisitionStatusBefore },
      newValue: { status: result.requisitionStatusAfter },
    });

    if (result.quotationStatusChanges.length) {
      await this.audit.log({
        userId: user.id,
        tenantId,
        entityType: 'REQUISITION',
        entityId: result.requisitionId,
        action: 'UPDATE',
        newValue: {
          event: 'quotation_statuses_synced',
          changes: result.quotationStatusChanges,
        },
      });
    }

    void this.notifyApproversForPendingSignature(
      tenantId,
      result.order.id,
    ).catch((err) =>
      this.logger.warn(
        `No se pudo enviar notificación push (nueva OC): ${err}`,
      ),
    );

    return result.order;
  }

  async approve(orderId: string, comment: string | undefined, user: any) {
    const tenantId = user.tenantId;

    const order = await this.prisma.purchaseOrder.findFirst({
      where: { id: orderId, tenantId },
      include: { approvals: true },
    });

    if (!order) throw new NotFoundException('Orden de compra no encontrada');

    assertUserHasContractAccess(
      user,
      order.contractId,
      'No tiene acceso al contrato de esta orden de compra',
    );

    if (!['PENDING_APPROVAL', 'PARTIALLY_APPROVED'].includes(order.status)) {
      throw new BadRequestException('La OC no está pendiente de aprobación');
    }

    const userAlreadySigned = order.approvals.some(
      (a) => a.approvedById === user.id,
    );
    if (userAlreadySigned) {
      throw new ConflictException(
        'Ya registró una firma en esta orden de compra. No puede volver a firmar la misma OC.',
      );
    }

    const policies = await this.prisma.approvalPolicy.findMany({
      where: { tenantId },
      include: { allowedUsers: true },
      orderBy: { level: 'asc' },
    });

    const matchingPolicy = resolveApprovalPolicyForUser(policies, {
      id: user.id,
    });

    if (!matchingPolicy) {
      throw new ForbiddenException(
        'No estás autorizado para firmar en ningún nivel de aprobación configurado',
      );
    }

    if (matchingPolicy.level > order.requiredSignatures) {
      throw new BadRequestException(
        'Tu nivel de firma no es requerido para esta OC',
      );
    }

    if (
      Number(matchingPolicy.minAmount) > 0 &&
      Number(order.totalAmount) < Number(matchingPolicy.minAmount)
    ) {
      throw new BadRequestException(
        `El monto de la OC (${order.totalAmount}) no alcanza el mínimo requerido para el Nivel ${matchingPolicy.level} (${matchingPolicy.minAmount})`,
      );
    }

    const existingApproval = order.approvals.find(
      (a) => a.level === matchingPolicy.level,
    );
    if (existingApproval) {
      throw new ConflictException(
        `El nivel ${matchingPolicy.level} ya tiene una firma registrada. Cada nivel se firma una sola vez; la siguiente aprobación corresponde al rol configurado para el siguiente nivel.`,
      );
    }

    const signedLevels = new Set(order.approvals.map((a) => a.level));
    const n = matchingPolicy.level;
    for (let level = 1; level < n; level++) {
      if (!signedLevels.has(level)) {
        throw new BadRequestException(
          `No se puede firmar el Nivel ${n} sin la aprobación previa de los niveles anteriores.`,
        );
      }
    }

    const now = new Date();
    const statusAtSign = order.status;
    const payload: SignaturePayload = {
      userId: user.id,
      orderId: order.id,
      totalAmount: order.totalAmount.toString(),
      status: statusAtSign,
      timestamp: now.toISOString(),
      tenantId,
    };
    const signatureHash = generateSignatureHash(payload);
    const statusBefore = order.status;

    const result = await this.prisma.$transaction(async (tx) => {
      const approval = await tx.purchaseOrderApproval.create({
        data: {
          purchaseOrderId: orderId,
          policyId: matchingPolicy.id,
          approvedById: user.id,
          level: matchingPolicy.level,
          comment,
          signatureHash,
          hashedStatus: statusAtSign,
          integrityStatus: 'VALID',
          approvedAt: now,
        },
        include: {
          policy: { select: { id: true, level: true, description: true } },
          approvedBy: { select: { id: true, name: true } },
        },
      });

      const totalApprovals = order.approvals.length + 1;
      const newStatus =
        totalApprovals >= order.requiredSignatures
          ? 'APPROVED'
          : 'PARTIALLY_APPROVED';

      await tx.purchaseOrder.update({
        where: { id: orderId },
        data: { status: newStatus },
      });

      return { approval, orderStatus: newStatus };
    });

    await this.audit.log({
      userId: user.id,
      tenantId,
      entityType: 'PURCHASE_ORDER',
      entityId: orderId,
      action: 'SIGNATURE',
      oldValue: { status: statusBefore },
      newValue: {
        status: result.orderStatus,
        signatureLevel: matchingPolicy.level,
        comment: comment ?? null,
      },
    });

    if (result.orderStatus === 'PARTIALLY_APPROVED') {
      void this.notifyApproversForPendingSignature(tenantId, orderId).catch(
        (err) =>
          this.logger.warn(
            `No se pudo enviar notificación push (siguiente firma): ${err}`,
          ),
      );
    }

    return result;
  }

  async reject(orderId: string, reason: string | undefined, user: any) {
    const order = await this.prisma.purchaseOrder.findFirst({
      where: { id: orderId, tenantId: user.tenantId },
    });

    if (!order) throw new NotFoundException('Orden de compra no encontrada');

    assertUserHasContractAccess(
      user,
      order.contractId,
      'No tiene acceso al contrato de esta orden de compra',
    );

    if (!['PENDING_APPROVAL', 'PARTIALLY_APPROVED'].includes(order.status)) {
      throw new BadRequestException('La OC no está pendiente de aprobación');
    }

    const prevStatus = order.status;
    const updated = await this.prisma.purchaseOrder.update({
      where: { id: orderId },
      data: { status: 'REJECTED', notes: reason ?? order.notes },
    });

    await this.audit.log({
      userId: user.id,
      tenantId: user.tenantId,
      entityType: 'PURCHASE_ORDER',
      entityId: orderId,
      action: 'STATUS_CHANGE',
      oldValue: { status: prevStatus },
      newValue: { status: updated.status, reason: reason ?? null },
    });

    return updated;
  }

  async cancel(orderId: string, reason: string | undefined, user: any) {
    const order = await this.prisma.purchaseOrder.findFirst({
      where: { id: orderId, tenantId: user.tenantId },
      include: {
        items: { select: { sourceQuotationItemId: true } },
        quotation: { select: { requisitionId: true } },
      },
    });

    if (!order) throw new NotFoundException('Orden de compra no encontrada');
    assertUserHasContractAccess(
      user,
      order.contractId,
      'No tiene acceso al contrato de esta orden de compra',
    );

    const cancelReason = reason?.trim();
    if (!cancelReason) {
      throw new BadRequestException(
        'Debe proporcionar un motivo de anulación de la OC.',
      );
    }
    if (['CANCELLED', 'RECEIVED', 'CLOSED'].includes(order.status)) {
      throw new BadRequestException(
        'La OC no puede anularse en su estado actual.',
      );
    }

    const hasOperationalReceipts = await this.prisma.warehouseReceipt.count({
      where: {
        purchaseOrderId: orderId,
        status: { in: ['PARTIAL', 'COMPLETED'] },
      },
    });
    if (hasOperationalReceipts > 0) {
      throw new BadRequestException(
        'No se puede anular una OC con recepciones de bodega confirmadas.',
      );
    }

    const previousStatus = order.status;
    const tenantId = user.tenantId;
    const requisitionId =
      order.requisitionId ?? order.quotation?.requisitionId ?? null;

    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.purchaseOrder.update({
        where: { id: orderId },
        data: { status: 'CANCELLED', notes: cancelReason },
      });

      if (requisitionId) {
        const sourceIds = order.items
          .map((i) => i.sourceQuotationItemId)
          .filter((id): id is string => id != null);

        for (const sqId of new Set(sourceIds)) {
          const otherActive = await tx.purchaseOrderItem.count({
            where: {
              sourceQuotationItemId: sqId,
              purchaseOrder: {
                tenantId,
                id: { not: orderId },
                status: { notIn: PO_INACTIVE_STATUSES },
                OR: [{ requisitionId }, { quotation: { requisitionId } }],
              },
            },
          });
          if (otherActive === 0) {
            await tx.requisitionItem.updateMany({
              where: {
                requisitionId,
                awardedQuotationItemId: sqId,
              },
              data: { awardedQuotationItemId: null },
            });
          }
        }

        await this.applyRequisitionCoverageStatusAfterPurchase(
          tx,
          requisitionId,
        );
      }

      return u;
    });

    await this.audit.log({
      userId: user.id,
      tenantId,
      entityType: 'PURCHASE_ORDER',
      entityId: orderId,
      action: 'STATUS_CHANGE',
      oldValue: { status: previousStatus },
      newValue: { status: updated.status, reason: cancelReason },
    });

    const hadSourcedLines = order.items.some(
      (i) => i.sourceQuotationItemId != null,
    );
    if (requisitionId && hadSourcedLines) {
      await this.audit.log({
        userId: user.id,
        tenantId,
        entityType: 'REQUISITION',
        entityId: requisitionId,
        action: 'UPDATE',
        newValue: {
          event: 'awards_released_after_po_cancel',
          purchaseOrderCorrelative: order.correlative,
          message: `Tras anular la OC ${order.correlative}, se liberaron adjudicaciones de línea vinculadas a esa orden para permitir re-cotización o nueva adjudicación.`,
        },
      });
    }

    return updated;
  }

  async resetToDraft(orderId: string, user: any) {
    const tenantId = user.tenantId;
    const order = await this.prisma.purchaseOrder.findFirst({
      where: { id: orderId, tenantId },
    });

    if (!order) throw new NotFoundException('Orden de compra no encontrada');

    assertUserHasContractAccess(
      user,
      order.contractId,
      'No tiene acceso al contrato de esta orden de compra',
    );

    if (order.status !== 'REJECTED') {
      throw new BadRequestException(
        'Solo se puede reiniciar una OC en estado REJECTED',
      );
    }

    const prevStatus = order.status;

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.purchaseOrderApproval.deleteMany({
        where: { purchaseOrderId: orderId },
      });

      return tx.purchaseOrder.update({
        where: { id: orderId },
        data: { status: 'DRAFT', notes: null },
      });
    });

    await this.audit.log({
      userId: user.id,
      tenantId,
      entityType: 'PURCHASE_ORDER',
      entityId: orderId,
      action: 'STATUS_CHANGE',
      oldValue: { status: prevStatus },
      newValue: { status: updated.status, approvalsCleared: true },
    });

    return updated;
  }

  async updateSensitiveFields(
    orderId: string,
    data: { totalAmount?: number; vendorId?: string; items?: any[] },
    user: any,
  ) {
    const tenantId = user.tenantId;
    const order = await this.prisma.purchaseOrder.findFirst({
      where: { id: orderId, tenantId },
      include: { approvals: true, items: true },
    });

    if (!order) throw new NotFoundException('Orden de compra no encontrada');

    assertUserHasContractAccess(
      user,
      order.contractId,
      'No tiene acceso al contrato de esta orden de compra',
    );

    const editableStatuses = [
      'DRAFT',
      'PENDING_APPROVAL',
      'PARTIALLY_APPROVED',
    ];
    if (!editableStatuses.includes(order.status)) {
      throw new BadRequestException(
        'La OC no se puede editar en su estado actual',
      );
    }

    const before = {
      totalAmount: Number(order.totalAmount),
      status: order.status,
      requiredSignatures: order.requiredSignatures,
      itemsCount: order.items.length,
    };

    const updated = await this.prisma.$transaction(async (tx) => {
      if (order.approvals.length > 0) {
        await tx.purchaseOrderApproval.deleteMany({
          where: { purchaseOrderId: orderId },
        });
      }

      const updateData: any = { status: 'PENDING_APPROVAL' };
      if (data.totalAmount !== undefined) {
        updateData.totalAmount = data.totalAmount;

        const settings = await tx.purchaseSettings.findUnique({
          where: { tenantId },
        });
        const threshold = settings ? Number(settings.approvalThreshold) : 0;
        updateData.requiredSignatures =
          data.totalAmount >= threshold && threshold > 0 ? 3 : 2;
      }

      if (data.items) {
        await tx.purchaseOrderItem.deleteMany({
          where: { purchaseOrderId: orderId },
        });
        await tx.purchaseOrderItem.createMany({
          data: data.items.map((item) => ({
            purchaseOrderId: orderId,
            description: item.description,
            quantity: item.quantity,
            unitCost: item.unitCost,
            inventoryItemId: item.inventoryItemId,
          })),
        });
      }

      return tx.purchaseOrder.update({
        where: { id: orderId },
        data: updateData,
        include: { items: true },
      });
    });

    const after = {
      totalAmount: Number(updated.totalAmount),
      status: updated.status,
      requiredSignatures: updated.requiredSignatures,
      itemsCount: updated.items.length,
    };
    const { oldValue, newValue } = pickChanged(
      before as Record<string, unknown>,
      after as Record<string, unknown>,
    );
    if (Object.keys(oldValue).length > 0) {
      await this.audit.log({
        userId: user.id,
        tenantId,
        entityType: 'PURCHASE_ORDER',
        entityId: orderId,
        action: 'UPDATE',
        oldValue,
        newValue,
      });
    }

    if (data.items?.length) {
      const lineDiffs = this.diffPoLineEdits(order.items, data.items);
      for (const d of lineDiffs) {
        await this.audit.log({
          userId: user.id,
          tenantId,
          entityType: 'PURCHASE_ORDER',
          entityId: orderId,
          action: ActivityAction.UPDATE,
          oldValue: {
            itemLabel: d.label,
            [d.fieldKey]: d.prev,
          },
          newValue: {
            itemLabel: d.label,
            [d.fieldKey]: d.next,
          },
          unified: {
            field: d.fieldKey,
            prev: d.prev,
            next: d.next,
            metadata: {
              itemDescription: d.label,
              event:
                d.fieldKey === 'unitCost'
                  ? 'po_line_unit_cost_changed'
                  : 'po_line_quantity_changed',
            },
          },
        });
      }
    }

    if (updated.status === 'PENDING_APPROVAL') {
      void this.notifyApproversForPendingSignature(tenantId, orderId).catch(
        (err) =>
          this.logger.warn(
            `No se pudo enviar notificación push (OC reabierta a firma): ${err}`,
          ),
      );
    }

    return updated;
  }

  async forceClose(orderId: string, reason: string, user: any) {
    const order = await this.prisma.purchaseOrder.findFirst({
      where: { id: orderId, tenantId: user.tenantId },
    });

    if (!order) throw new NotFoundException('Orden de compra no encontrada');

    assertUserHasContractAccess(
      user,
      order.contractId,
      'No tiene acceso al contrato de esta orden de compra',
    );

    if (order.status !== 'PARTIALLY_RECEIVED') {
      throw new BadRequestException(
        'Solo se puede cerrar administrativamente una OC parcialmente recibida',
      );
    }

    if (!reason?.trim()) {
      throw new BadRequestException(
        'Debe proporcionar una justificación para el cierre administrativo',
      );
    }

    const prevStatus = order.status;
    const updated = await this.prisma.purchaseOrder.update({
      where: { id: orderId },
      data: { status: 'CLOSED', notes: reason },
    });

    await this.audit.log({
      userId: user.id,
      tenantId: user.tenantId,
      entityType: 'PURCHASE_ORDER',
      entityId: orderId,
      action: 'STATUS_CHANGE',
      oldValue: { status: prevStatus },
      newValue: { status: updated.status, reason },
    });

    return updated;
  }

  /**
   * Marca la OC como enviada al proveedor (documento comunicado). Solo desde APPROVED.
   */
  async markAsSentToSupplier(orderId: string, user: any) {
    const tenantId = user.tenantId;
    const order = await this.prisma.purchaseOrder.findFirst({
      where: { id: orderId, tenantId },
    });

    if (!order) throw new NotFoundException('Orden de compra no encontrada');

    assertUserHasContractAccess(
      user,
      order.contractId,
      'No tiene acceso al contrato de esta orden de compra',
    );

    if (order.status !== 'APPROVED') {
      throw new BadRequestException(
        'Solo una orden aprobada puede marcarse como enviada al proveedor',
      );
    }

    const prevStatus = order.status;
    const sentAt = new Date();
    const updated = await this.prisma.purchaseOrder.update({
      where: { id: orderId },
      data: { status: 'SENT', sentAt },
    });

    const actor = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { name: true },
    });

    await this.audit.log({
      userId: user.id,
      tenantId,
      entityType: 'PURCHASE_ORDER',
      entityId: orderId,
      action: 'STATUS_CHANGE',
      oldValue: { status: prevStatus },
      newValue: {
        status: updated.status,
        event: 'marked_sent_to_supplier',
        sentAt: sentAt.toISOString(),
        performedByUserId: user.id,
        performedByName: actor?.name ?? '',
      },
      unified: {
        field: 'status',
        prev: prevStatus,
        next: updated.status,
        metadata: {
          sentAt: sentAt.toISOString(),
          performedByUserId: user.id,
          performedByName: actor?.name ?? '',
        },
      },
    });

    return updated;
  }

  /**
   * Notifica por Web Push a los usuarios cuyo rol coincide con la política del
   * siguiente nivel de firma pendiente (según ApprovalPolicy).
   */
  /**
   * Compara líneas de OC antes/después de `updateSensitiveFields` (mismo ítem por inventario o descripción).
   */
  private diffPoLineEdits(
    before: Array<{
      description: string;
      quantity: number;
      unitCost: unknown;
      inventoryItemId: string | null;
    }>,
    after: Array<{
      description?: string;
      quantity?: number;
      unitCost?: number;
      inventoryItemId?: string | null;
    }>,
  ): Array<{
    label: string;
    fieldKey: 'unitCost' | 'quantity';
    prev: number;
    next: number;
  }> {
    const out: Array<{
      label: string;
      fieldKey: 'unitCost' | 'quantity';
      prev: number;
      next: number;
    }> = [];
    for (const b of before) {
      const match = after.find(
        (a) =>
          (b.inventoryItemId != null &&
            a.inventoryItemId != null &&
            a.inventoryItemId === b.inventoryItemId) ||
          (b.inventoryItemId == null &&
            String(a.description ?? '').trim() ===
              String(b.description ?? '').trim()),
      );
      if (!match) continue;
      const label = (b.description || 'Ítem').trim();
      const bu = Number(b.unitCost);
      const bq = Number(b.quantity);
      const au = Number(match.unitCost);
      const aq = Number(match.quantity);
      if (!Number.isNaN(bu) && !Number.isNaN(au) && bu !== au) {
        out.push({
          label,
          fieldKey: 'unitCost',
          prev: bu,
          next: au,
        });
      }
      if (!Number.isNaN(bq) && !Number.isNaN(aq) && bq !== aq) {
        out.push({
          label,
          fieldKey: 'quantity',
          prev: bq,
          next: aq,
        });
      }
    }
    return out;
  }

  /** Destinatarios del siguiente nivel de firma según política y contrato (reutilizable en batch). */
  private async findUserIdsForNextApprovalPolicy(
    tenantId: string,
    contractId: string,
    nextPolicy: { allowedUsers: Array<{ userId: string }> },
  ): Promise<string[]> {
    const allowedUserIds = nextPolicy.allowedUsers.map((au) => au.userId);
    if (!allowedUserIds.length) return [];

    const contractScope: Prisma.UserWhereInput = {
      OR: [
        { role: 'ADMIN' },
        { role: 'SUPER_ADMIN' },
        { contractAccess: { some: { contractId } } },
      ],
    };

    const recipients = await this.prisma.user.findMany({
      where: {
        tenantId,
        isActive: true,
        id: { in: allowedUserIds },
        AND: [contractScope],
      },
      select: { id: true },
    });
    return recipients.map((u) => u.id);
  }

  private async resolvePendingSignatureRecipients(
    tenantId: string,
    orderId: string,
  ): Promise<{
    userIds: string[];
    order: {
      id: string;
      correlative: string;
      currency: string;
      totalAmount: unknown;
    };
    nextLevel: number;
    nextDescription: string;
  } | null> {
    const order = await this.prisma.purchaseOrder.findFirst({
      where: { id: orderId, tenantId },
      include: {
        approvals: { select: { level: true } },
      },
    });
    if (!order) return null;
    if (!['PENDING_APPROVAL', 'PARTIALLY_APPROVED'].includes(order.status)) {
      return null;
    }

    const signedLevels = new Set(order.approvals.map((a) => a.level));
    const policies = await this.prisma.approvalPolicy.findMany({
      where: {
        tenantId,
        level: { lte: order.requiredSignatures },
      },
      include: { allowedUsers: true },
      orderBy: { level: 'asc' },
    });
    const nextPolicy = policies.find((p) => !signedLevels.has(p.level));
    if (!nextPolicy) return null;

    const userIds = await this.findUserIdsForNextApprovalPolicy(
      tenantId,
      order.contractId,
      nextPolicy,
    );

    const nextDescription = nextPolicy.description
      ? `${nextPolicy.description}`
      : `Nivel ${nextPolicy.level}`;

    return {
      userIds,
      order: {
        id: order.id,
        correlative: order.correlative,
        currency: order.currency,
        totalAmount: order.totalAmount,
      },
      nextLevel: nextPolicy.level,
      nextDescription,
    };
  }

  /**
   * Un solo push (y correo si SMTP está OK) para varias OC recién creadas en un split.
   */
  private async notifyApproversForPendingSignatureBatch(
    tenantId: string,
    orderIds: string[],
    summary: { requisitionCorrelative: string; vendorNames: string[] },
  ): Promise<void> {
    if (!orderIds.length) return;

    const orders = await this.prisma.purchaseOrder.findMany({
      where: { id: { in: orderIds }, tenantId },
      select: {
        id: true,
        status: true,
        contractId: true,
        currency: true,
        totalAmount: true,
        requiredSignatures: true,
        approvals: { select: { level: true } },
      },
    });
    if (!orders.length) return;

    const maxSig = Math.max(1, ...orders.map((o) => o.requiredSignatures));
    const policies = await this.prisma.approvalPolicy.findMany({
      where: { tenantId, level: { lte: maxSig } },
      include: { allowedUsers: true },
      orderBy: { level: 'asc' },
    });

    const recipientSet = new Set<string>();
    const recipientCache = new Map<string, string[]>();

    for (const order of orders) {
      if (!['PENDING_APPROVAL', 'PARTIALLY_APPROVED'].includes(order.status)) {
        continue;
      }
      const signedLevels = new Set(order.approvals.map((a) => a.level));
      const relevantPolicies = policies.filter(
        (p) => p.level <= order.requiredSignatures,
      );
      const nextPolicy = relevantPolicies.find(
        (p) => !signedLevels.has(p.level),
      );
      if (!nextPolicy) continue;

      const cacheKey = `${order.contractId}|${nextPolicy.id}`;
      let userIds = recipientCache.get(cacheKey);
      if (!userIds) {
        userIds = await this.findUserIdsForNextApprovalPolicy(
          tenantId,
          order.contractId,
          nextPolicy,
        );
        recipientCache.set(cacheKey, userIds);
      }
      userIds.forEach((id) => recipientSet.add(id));
    }

    if (!recipientSet.size) return;

    const orderRowsForCorrelatives = await this.prisma.purchaseOrder.findMany({
      where: { id: { in: orderIds }, tenantId },
      select: { correlative: true },
      orderBy: { correlative: 'asc' },
    });
    const correlatives = orderRowsForCorrelatives.map((o) => o.correlative);
    const n = orderIds.length;
    const vendorList = summary.vendorNames.length
      ? summary.vendorNames.join(', ')
      : '—';
    const byCurrency = new Map<string, number>();
    for (const o of orders) {
      const cur = (o.currency ?? 'CLP').trim() || 'CLP';
      byCurrency.set(
        cur,
        (byCurrency.get(cur) ?? 0) + Number(o.totalAmount ?? 0),
      );
    }
    const aggTotals = [...byCurrency.entries()]
      .map(
        ([c, v]) =>
          `${c} ${v.toLocaleString('es-CL', { maximumFractionDigits: 0 })}`,
      )
      .join(' · ');
    const title =
      n === 1
        ? '1 orden de compra pendiente de firma'
        : `${n} órdenes de compra pendientes de firma`;
    const body = `Se ${n === 1 ? 'ha' : 'han'} generado ${n} ${
      n === 1 ? 'orden de compra' : 'órdenes de compra'
    } para el requerimiento ${
      summary.requisitionCorrelative
    }. Proveedores involucrados: ${vendorList}. OC: ${correlatives.join(', ')}. Monto total agregado (${n} OC): ${aggTotals}.`;

    const data: Record<string, string> = {
      type: 'PURCHASE_ORDER_BATCH_PENDING_SIGNATURE',
      requisitionCorrelative: summary.requisitionCorrelative,
      orderIds: orderIds.join(','),
      firstOrderId: orderIds[0] ?? '',
    };

    await Promise.all(
      [...recipientSet].map((uid) =>
        this.notifications.sendNotification(uid, title, body, data),
      ),
    );

    try {
      const users = await this.prisma.user.findMany({
        where: {
          id: { in: [...recipientSet] },
          tenantId,
          isActive: true,
        },
        select: { email: true },
      });
      const html = `<p>${body}</p><p style="color:#666;font-size:12px">Baselogic · Compras</p>`;
      for (const u of users) {
        const to = u.email?.trim();
        if (!to?.includes('@')) continue;
        await this.emailService.sendMail({
          to,
          subject: title,
          html,
        });
      }
    } catch (err) {
      this.logger.warn(
        `Correo resumen OC split no enviado (SMTP o Mailer): ${String(err)}`,
      );
    }
  }

  private async notifyApproversForPendingSignature(
    tenantId: string,
    orderId: string,
  ): Promise<void> {
    const resolved = await this.resolvePendingSignatureRecipients(
      tenantId,
      orderId,
    );
    if (!resolved) return;

    const amt = Number(resolved.order.totalAmount).toLocaleString('es-CL', {
      maximumFractionDigits: 0,
    });
    const title = `OC ${resolved.order.correlative} pendiente de firma`;
    const body = `${resolved.nextDescription}. Monto: ${resolved.order.currency} ${amt}.`;
    const data: Record<string, string> = {
      orderId: resolved.order.id,
      correlative: resolved.order.correlative,
      type: 'PURCHASE_ORDER_PENDING_SIGNATURE',
      level: String(resolved.nextLevel),
    };

    await Promise.all(
      resolved.userIds.map((uid) =>
        this.notifications.sendNotification(uid, title, body, data),
      ),
    );
  }
}
