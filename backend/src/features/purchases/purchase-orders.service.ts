import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import type { Readable } from 'stream';
import { PrismaService } from '../../prisma/prisma.service';
import { SequenceService } from '../../common/sequence/sequence.service';
import { StorageService } from '../../common/storage/storage.service';
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

const SUBCONTRACT_SELECT = { select: { id: true, code: true, name: true } } as const;

@Injectable()
export class PurchaseOrdersService {
  private readonly logger = new Logger(PurchaseOrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sequenceService: SequenceService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async findAll(tenantId: string, status?: string) {
    return this.prisma.purchaseOrder.findMany({
      where: {
        tenantId,
        ...(status && { status: status as any }),
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

  async findById(id: string, tenantId: string) {
    const order = await this.prisma.purchaseOrder.findFirst({
      where: { id, tenantId },
      include: {
        contract: { select: { id: true, code: true, name: true } },
        subcontract: SUBCONTRACT_SELECT,
        quotation: {
          include: {
            vendor: { select: { id: true, name: true, code: true } },
            requisition: { select: { id: true, correlative: true, description: true } },
          },
        },
        items: {
          include: {
            inventoryItem: { select: { id: true, partNumber: true, name: true } },
          },
        },
        approvals: {
          include: {
            policy: { select: { id: true, level: true, description: true } },
            approvedBy: { select: { id: true, name: true, email: true } },
          },
          orderBy: { level: 'asc' },
        },
      },
    });

    if (!order) throw new NotFoundException('Orden de compra no encontrada');

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
    const orFilter = requisitionId
      ? [
          { entityType: 'PURCHASE_ORDER' as const, entityId: orderId },
          { entityType: 'REQUISITION' as const, entityId: requisitionId },
        ]
      : [{ entityType: 'PURCHASE_ORDER' as const, entityId: orderId }];

    return this.prisma.activityLog.findMany({
      where: {
        tenantId,
        OR: orFilter,
      },
      orderBy: { createdAt: 'asc' },
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
    });
  }

  /**
   * Resuelve la clave interna de almacenamiento a partir de pdfUrl (clave o ruta /uploads/...).
   */
  private resolvePdfStorageKey(pdfUrl: string): string {
    const trimmed = pdfUrl.trim();
    if (trimmed.startsWith('/uploads/')) {
      return trimmed.slice('/uploads/'.length);
    }
    try {
      const u = new URL(trimmed);
      const path = u.pathname;
      if (path.startsWith('/uploads/')) {
        return path.slice('/uploads/'.length);
      }
    } catch {
      /* no es URL absoluta */
    }
    return trimmed;
  }

  /**
   * Obtiene un stream de lectura del PDF de la OC para el tenant indicado.
   * Lanza NotFoundException si la OC no existe, no tiene pdfUrl o el archivo no está en disco.
   */
  async getPurchaseOrderPdfStream(
    id: string,
    tenantId: string,
  ): Promise<Readable> {
    const order = await this.prisma.purchaseOrder.findFirst({
      where: { id, tenantId },
      select: { id: true, pdfUrl: true },
    });

    if (!order || !order.pdfUrl?.trim()) {
      throw new NotFoundException(
        'Orden de compra no encontrada o sin PDF generado',
      );
    }

    const key = this.resolvePdfStorageKey(order.pdfUrl);

    try {
      return await this.storage.getFileStream(key);
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException)?.code;
      const message = err instanceof Error ? err.message : String(err);
      if (
        code === 'ENOENT' ||
        message.includes('ENOENT') ||
        message.includes('not found')
      ) {
        throw new NotFoundException(
          'El archivo PDF no está disponible en el servidor',
        );
      }
      throw err;
    }
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

      const existingPO = await tx.purchaseOrder.findFirst({
        where: { quotationId },
      });
      if (existingPO) {
        throw new ConflictException('Ya existe una OC para esta cotización');
      }

      const requisitionStatusBefore = quotation.requisition.status;

      const settings = await tx.purchaseSettings.findUnique({
        where: { tenantId },
      });
      const threshold = settings ? Number(settings.approvalThreshold) : 0;
      const totalAmount = Number(quotation.totalAmount);
      const requiredSignatures = totalAmount >= threshold && threshold > 0 ? 3 : 2;

      const correlative = await this.sequenceService.getNextCorrelative(
        tenantId, 'OC', 'OC', tx,
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
          items: {
            create: quotation.items.map((qi) => ({
              description: qi.requisitionItem.description,
              quantity: qi.requisitionItem.quantity,
              unitCost: qi.unitPrice,
              inventoryItemId: qi.requisitionItem.inventoryItemId,
            })),
          },
        },
        include: { items: true },
      });

      await tx.purchaseRequisition.update({
        where: { id: quotation.requisitionId },
        data: { status: 'APPROVED' },
      });

      return { order: created, requisitionStatusBefore, requisitionId: quotation.requisitionId };
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
      this.logger.warn(`No se pudo enviar notificación push (nueva OC): ${err}`),
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

    if (!['PENDING_APPROVAL', 'PARTIALLY_APPROVED'].includes(order.status)) {
      throw new BadRequestException('La OC no está pendiente de aprobación');
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
        `El nivel ${matchingPolicy.level} ya fue firmado`,
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

  async resetToDraft(orderId: string, user: any) {
    const tenantId = user.tenantId;
    const order = await this.prisma.purchaseOrder.findFirst({
      where: { id: orderId, tenantId },
    });

    if (!order) throw new NotFoundException('Orden de compra no encontrada');

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
   * Notifica por Web Push a los usuarios cuyo rol coincide con la política del
   * siguiente nivel de firma pendiente (según ApprovalPolicy).
   */
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

    const recipients = await this.prisma.user.findMany({
      where: {
        tenantId,
        isActive: true,
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
