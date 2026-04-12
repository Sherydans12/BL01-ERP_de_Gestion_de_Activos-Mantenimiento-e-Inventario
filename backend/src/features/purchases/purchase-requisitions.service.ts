import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SequenceService } from '../../common/sequence/sequence.service';
import { StorageService } from '../../common/storage/storage.service';
import { AuditService, pickChanged } from '../../common/audit/audit.service';
import { RequisitionStatus } from '@prisma/client';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string | undefined | null): boolean {
  return typeof value === 'string' && UUID_RE.test(value);
}

const SUBCONTRACT_SELECT = { select: { id: true, code: true, name: true } } as const;

@Injectable()
export class PurchaseRequisitionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequenceService: SequenceService,
    private readonly storageService: StorageService,
    private readonly audit: AuditService,
  ) {}

  async findAll(tenantId: string, contractId?: string, status?: string) {
    return this.prisma.purchaseRequisition.findMany({
      where: {
        tenantId,
        ...(contractId && contractId !== 'ALL' && { contractId }),
        ...(status && { status: status as RequisitionStatus }),
      },
      include: {
        requestedBy: { select: { id: true, name: true, email: true } },
        contract: { select: { id: true, code: true, name: true } },
        subcontract: SUBCONTRACT_SELECT,
        _count: { select: { items: true, quotations: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(id: string, tenantId: string) {
    const requisition = await this.prisma.purchaseRequisition.findFirst({
      where: { id, tenantId },
      include: {
        requestedBy: { select: { id: true, name: true, email: true } },
        contract: { select: { id: true, code: true, name: true } },
        subcontract: SUBCONTRACT_SELECT,
        items: {
          include: {
            inventoryItem: { select: { id: true, partNumber: true, name: true } },
          },
        },
        quotations: {
          include: {
            vendor: { select: { id: true, code: true, name: true } },
            items: {
              include: {
                requisitionItem: { select: { id: true, description: true } },
              },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!requisition) throw new NotFoundException('Requerimiento no encontrado');
    return requisition;
  }

  async create(
    data: {
      contractId: string;
      subcontractId?: string;
      description: string;
      justification?: string;
      items: Array<{
        inventoryItemId?: string;
        description: string;
        quantity: number;
        unitOfMeasure: string;
        estimatedCost?: number;
      }>;
    },
    user: any,
  ) {
    const tenantId = user.tenantId;

    if (
      !data.contractId ||
      data.contractId === 'ALL' ||
      !isUuid(data.contractId)
    ) {
      throw new BadRequestException(
        'Debe indicar un contrato válido. Si usa la vista global, elija un contrato en el formulario.',
      );
    }

    const contract = await this.prisma.contract.findFirst({
      where: { id: data.contractId, tenantId },
      select: { id: true },
    });
    if (!contract) {
      throw new BadRequestException(
        'El contrato no existe o no pertenece a su organización',
      );
    }

    if (data.subcontractId) {
      if (!isUuid(data.subcontractId)) {
        throw new BadRequestException('ID de subcontrato inválido');
      }
      const sub = await this.prisma.subcontract.findFirst({
        where: { id: data.subcontractId, contractId: data.contractId },
        select: { id: true },
      });
      if (!sub) {
        throw new BadRequestException(
          'El subcontrato no pertenece al contrato seleccionado',
        );
      }
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const correlative = await this.sequenceService.getNextCorrelative(
        tenantId, 'SRC', 'SRC', tx,
      );

      return tx.purchaseRequisition.create({
        data: {
          tenantId,
          contractId: data.contractId,
          subcontractId: data.subcontractId || undefined,
          correlative,
          requestedById: user.id,
          description: data.description,
          justification: data.justification,
          items: {
            create: data.items.map((item) => ({
              description: item.description,
              quantity: item.quantity,
              unitOfMeasure: item.unitOfMeasure,
              estimatedCost: item.estimatedCost,
              inventoryItemId: item.inventoryItemId,
            })),
          },
        },
        include: {
          items: true,
          requestedBy: { select: { id: true, name: true } },
        },
      });
    });

    await this.audit.log({
      userId: user.id,
      tenantId,
      entityType: 'REQUISITION',
      entityId: created.id,
      action: 'CREATE',
      newValue: {
        correlative: created.correlative,
        status: created.status,
        description: created.description,
        itemsCount: created.items.length,
      },
    });

    return created;
  }

  async update(id: string, data: any, user: any) {
    const requisition = await this.findById(id, user.tenantId);

    if (requisition.status !== 'DRAFT') {
      throw new BadRequestException('Solo se pueden editar requerimientos en estado DRAFT');
    }
    if (requisition.requestedById !== user.id && user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException('No tienes permiso para editar este requerimiento');
    }

    const before = {
      description: requisition.description,
      justification: requisition.justification ?? null,
      itemsCount: requisition.items.length,
    };

    const updated = await this.prisma.$transaction(async (tx) => {
      if (data.items) {
        await tx.requisitionItem.deleteMany({ where: { requisitionId: id } });
        await tx.requisitionItem.createMany({
          data: data.items.map((item: any) => ({
            requisitionId: id,
            description: item.description,
            quantity: item.quantity,
            unitOfMeasure: item.unitOfMeasure,
            estimatedCost: item.estimatedCost,
            inventoryItemId: item.inventoryItemId,
          })),
        });
      }

      return tx.purchaseRequisition.update({
        where: { id },
        data: {
          description: data.description,
          justification: data.justification,
        },
        include: { items: true },
      });
    });

    const after = {
      description: updated.description,
      justification: updated.justification ?? null,
      itemsCount: updated.items.length,
    };
    const { oldValue, newValue } = pickChanged(
      before as Record<string, unknown>,
      after as Record<string, unknown>,
    );
    if (Object.keys(oldValue).length > 0) {
      await this.audit.log({
        userId: user.id,
        tenantId: user.tenantId,
        entityType: 'REQUISITION',
        entityId: id,
        action: 'UPDATE',
        oldValue,
        newValue,
      });
    }

    return updated;
  }

  async submit(id: string, user: any) {
    const requisition = await this.findById(id, user.tenantId);

    if (requisition.status !== 'DRAFT') {
      throw new BadRequestException('Solo se pueden enviar requerimientos en estado DRAFT');
    }
    if (requisition.items.length === 0) {
      throw new BadRequestException('El requerimiento debe tener al menos un ítem');
    }

    const prevStatus = requisition.status;
    const updated = await this.prisma.purchaseRequisition.update({
      where: { id },
      data: { status: 'SUBMITTED' },
    });

    await this.audit.log({
      userId: user.id,
      tenantId: user.tenantId,
      entityType: 'REQUISITION',
      entityId: id,
      action: 'STATUS_CHANGE',
      oldValue: { status: prevStatus },
      newValue: { status: updated.status },
    });

    return updated;
  }

  async startQuoting(id: string, user: any) {
    const requisition = await this.findById(id, user.tenantId);

    if (requisition.status !== 'SUBMITTED') {
      throw new BadRequestException(
        'Solo se puede iniciar cotización cuando el requerimiento está enviado (Enviado)',
      );
    }

    const prevStatus = requisition.status;
    await this.prisma.purchaseRequisition.update({
      where: { id },
      data: { status: 'QUOTING' },
    });

    await this.audit.log({
      userId: user.id,
      tenantId: user.tenantId,
      entityType: 'REQUISITION',
      entityId: id,
      action: 'STATUS_CHANGE',
      oldValue: { status: prevStatus },
      newValue: { status: 'QUOTING' },
    });

    return this.findById(id, user.tenantId);
  }

  async addQuotation(
    requisitionId: string,
    data: {
      vendorId: string;
      totalAmount: number;
      currency?: string;
      deliveryDays?: number;
      validUntil?: string;
      items: Array<{
        requisitionItemId: string;
        unitPrice: number;
        brand?: string;
        notes?: string;
      }>;
    },
    file: { buffer: Buffer; originalname: string; mimetype: string } | undefined,
    user: any,
  ) {
    const requisition = await this.findById(requisitionId, user.tenantId);

    if (!['SUBMITTED', 'QUOTING'].includes(requisition.status)) {
      throw new BadRequestException('El requerimiento no acepta cotizaciones en su estado actual');
    }

    let attachmentUrl: string | undefined;
    if (file) {
      attachmentUrl = await this.storageService.uploadFile(file, 'quotations');
    }

    const reqStatusBefore = requisition.status;

    const qtyByReqItemId = new Map(
      requisition.items.map((ri) => [ri.id, Number(ri.quantity)]),
    );
    let computedTotal = 0;
    for (const line of data.items) {
      const qty = qtyByReqItemId.get(line.requisitionItemId);
      if (qty === undefined) {
        throw new BadRequestException(
          'Uno o más ítems de la cotización no pertenecen a este requerimiento',
        );
      }
      computedTotal += line.unitPrice * qty;
    }
    const declared = Number(data.totalAmount);
    if (Math.round(computedTotal * 100) !== Math.round(declared * 100)) {
      throw new BadRequestException(
        'El monto total no coincide con la suma de precio unitario × cantidad de los ítems de la cotización',
      );
    }

    const quotation = await this.prisma.$transaction(async (tx) => {
      const q = await tx.purchaseQuotation.create({
        data: {
          tenantId: user.tenantId,
          requisitionId,
          vendorId: data.vendorId,
          totalAmount: data.totalAmount,
          currency: data.currency ?? 'CLP',
          deliveryDays: data.deliveryDays,
          validUntil: data.validUntil ? new Date(data.validUntil) : undefined,
          attachmentUrl,
          items: {
            create: data.items.map((item) => ({
              requisitionItemId: item.requisitionItemId,
              unitPrice: item.unitPrice,
              brand: item.brand,
              notes: item.notes,
            })),
          },
        },
        include: {
          vendor: { select: { id: true, code: true, name: true } },
          items: true,
        },
      });

      if (requisition.status === 'SUBMITTED') {
        await tx.purchaseRequisition.update({
          where: { id: requisitionId },
          data: { status: 'QUOTING' },
        });
      }

      return q;
    });

    if (reqStatusBefore === 'SUBMITTED') {
      await this.audit.log({
        userId: user.id,
        tenantId: user.tenantId,
        entityType: 'REQUISITION',
        entityId: requisitionId,
        action: 'STATUS_CHANGE',
        oldValue: { status: reqStatusBefore },
        newValue: { status: 'QUOTING' },
      });
    }

    await this.audit.log({
      userId: user.id,
      tenantId: user.tenantId,
      entityType: 'REQUISITION',
      entityId: requisitionId,
      action: 'UPDATE',
      newValue: {
        event: 'quotation_added',
        quotationId: quotation.id,
        vendorId: data.vendorId,
        vendorName: quotation.vendor?.name,
        totalAmount: Number(quotation.totalAmount),
      },
    });

    return quotation;
  }

  async selectQuotation(
    requisitionId: string,
    quotationId: string,
    user: any,
  ) {
    const requisition = await this.findById(requisitionId, user.tenantId);

    if (requisition.status !== 'QUOTING') {
      throw new BadRequestException('El requerimiento no está en fase de cotización');
    }

    const quotation = requisition.quotations.find((q) => q.id === quotationId);
    if (!quotation) {
      throw new NotFoundException('Cotización no encontrada en este requerimiento');
    }

    const statusBefore = requisition.status;

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.purchaseQuotation.updateMany({
        where: { requisitionId, id: { not: quotationId } },
        data: { status: 'REJECTED', isWinner: false },
      });

      await tx.purchaseQuotation.update({
        where: { id: quotationId },
        data: { status: 'SELECTED', isWinner: true },
      });

      await tx.purchaseRequisition.update({
        where: { id: requisitionId },
        data: { status: 'PENDING_APPROVAL' },
      });

      return tx.purchaseQuotation.findUnique({
        where: { id: quotationId },
        include: {
          vendor: { select: { id: true, code: true, name: true } },
          items: true,
        },
      });
    });

    await this.audit.log({
      userId: user.id,
      tenantId: user.tenantId,
      entityType: 'REQUISITION',
      entityId: requisitionId,
      action: 'STATUS_CHANGE',
      oldValue: { status: statusBefore },
      newValue: {
        status: 'PENDING_APPROVAL',
        selectedQuotationId: quotationId,
      },
    });

    return result;
  }
}
