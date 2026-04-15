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
import {
  resolveApprovalPolicyForUser,
  SYSTEM_MIRROR_ROLE_NAME,
} from '../tenant-roles/tenant-role-defaults';
import {
  EQUIPMENT_LINK_SELECT,
  WORK_ORDER_LINK_SELECT,
} from './purchase-asset-links.include';
import { generatePurchaseOrderPdfBuffer } from './purchase-order-pdf.generator';
import { assertUserHasContractAccess } from './purchase-contract-access.util';
import { ActivityAction, Prisma } from '@prisma/client';

const SUBCONTRACT_SELECT = {
  select: { id: true, code: true, name: true },
} as const;

@Injectable()
export class PurchaseOrdersService {
  private readonly logger = new Logger(PurchaseOrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sequenceService: SequenceService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
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

    return { ...order, approvals: enrichedApprovals };
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
        quotation: { select: { requisitionId: true } },
      },
    });
    if (!order) throw new NotFoundException('Orden de compra no encontrada');

    const requisitionId = order.quotation?.requisitionId;
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

  async createFromQuotation(quotationId: string, user: any) {
    const tenantId = user.tenantId;

    const order = await this.prisma.$transaction(async (tx) => {
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
        where: { quotationId },
      });
      if (existingPO) {
        throw new ConflictException('Ya existe una OC para esta cotización');
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
            })),
          },
        },
        include: {
          items: true,
          equipment: EQUIPMENT_LINK_SELECT,
          workOrder: WORK_ORDER_LINK_SELECT,
        },
      });

      await tx.purchaseRequisition.update({
        where: { id: quotation.requisitionId },
        data: { status: 'APPROVED' },
      });

      return {
        order: created,
        requisitionStatusBefore,
        requisitionId: quotation.requisitionId,
      };
    });

    await this.audit.log({
      userId: user.id,
      tenantId,
      entityType: 'PURCHASE_ORDER',
      entityId: order.order.id,
      action: 'CREATE',
      newValue: {
        correlative: order.order.correlative,
        totalAmount: Number(order.order.totalAmount),
        status: order.order.status,
      },
    });
    await this.audit.log({
      userId: user.id,
      tenantId,
      entityType: 'REQUISITION',
      entityId: order.requisitionId,
      action: 'STATUS_CHANGE',
      oldValue: { status: order.requisitionStatusBefore },
      newValue: { status: 'APPROVED' },
    });

    void this.notifyApproversForPendingSignature(
      tenantId,
      order.order.id,
    ).catch((err) =>
      this.logger.warn(
        `No se pudo enviar notificación push (nueva OC): ${err}`,
      ),
    );

    return order.order;
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
      include: { role: true },
      orderBy: { level: 'asc' },
    });

    const matchingPolicy = resolveApprovalPolicyForUser(policies, {
      customRoleId: user.customRoleId ?? null,
      role: user.role,
    });

    if (!matchingPolicy) {
      throw new ForbiddenException(
        'Tu rol no tiene atribución de firma en las políticas de aprobación configuradas',
      );
    }

    if (matchingPolicy.level > order.requiredSignatures) {
      throw new BadRequestException(
        'Tu nivel de firma no es requerido para esta OC',
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
    const updated = await this.prisma.purchaseOrder.update({
      where: { id: orderId },
      data: { status: 'CANCELLED', notes: cancelReason },
    });

    await this.audit.log({
      userId: user.id,
      tenantId: user.tenantId,
      entityType: 'PURCHASE_ORDER',
      entityId: orderId,
      action: 'STATUS_CHANGE',
      oldValue: { status: previousStatus },
      newValue: { status: updated.status, reason: cancelReason },
    });

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

  private async notifyApproversForPendingSignature(
    tenantId: string,
    orderId: string,
  ): Promise<void> {
    const order = await this.prisma.purchaseOrder.findFirst({
      where: { id: orderId, tenantId },
      include: {
        approvals: { select: { level: true } },
      },
    });
    if (!order) return;
    if (!['PENDING_APPROVAL', 'PARTIALLY_APPROVED'].includes(order.status)) {
      return;
    }

    const signedLevels = new Set(order.approvals.map((a) => a.level));
    const policies = await this.prisma.approvalPolicy.findMany({
      where: {
        tenantId,
        level: { lte: order.requiredSignatures },
      },
      include: { role: true },
      orderBy: { level: 'asc' },
    });
    const nextPolicy = policies.find((p) => !signedLevels.has(p.level));
    if (!nextPolicy) return;

    const mirrorName = SYSTEM_MIRROR_ROLE_NAME[nextPolicy.role.baseRole];
    const policyIsMirror = nextPolicy.role.name === mirrorName;

    const policyRoleMatch: Prisma.UserWhereInput = {
      OR: [
        { customRoleId: nextPolicy.roleId },
        ...(policyIsMirror
          ? [
              {
                customRoleId: null,
                role: nextPolicy.role.baseRole,
              },
            ]
          : []),
      ],
    };

    const contractScope: Prisma.UserWhereInput = {
      OR: [
        { role: 'ADMIN' },
        { role: 'SUPER_ADMIN' },
        {
          contractAccess: {
            some: { contractId: order.contractId },
          },
        },
      ],
    };

    const recipients = await this.prisma.user.findMany({
      where: {
        tenantId,
        isActive: true,
        AND: [policyRoleMatch, contractScope],
      },
      select: { id: true },
    });

    const amt = Number(order.totalAmount).toLocaleString('es-CL', {
      maximumFractionDigits: 0,
    });
    const title = `OC ${order.correlative} pendiente de firma`;
    const desc = nextPolicy.description
      ? `${nextPolicy.description}`
      : `Nivel ${nextPolicy.level}`;
    const body = `${desc}. Monto: ${order.currency} ${amt}.`;
    const data: Record<string, string> = {
      orderId: order.id,
      correlative: order.correlative,
      type: 'PURCHASE_ORDER_PENDING_SIGNATURE',
      level: String(nextPolicy.level),
    };

    await Promise.all(
      recipients.map((u) =>
        this.notifications.sendNotification(u.id, title, body, data),
      ),
    );
  }
}
