import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ActivityAction, Prisma, PurchaseInvoiceStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { assertUserHasContractAccess } from './purchase-contract-access.util';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService, pickChanged } from '../../common/audit/audit.service';
import { buildActivityLogDetails } from '../../common/audit/activity-log-details.util';
import {
  requisitionIdFromPurchaseOrder,
  tryAutoCloseRequisitionIfFullyReconciled,
} from './purchase-requisition-auto-close.util';

const PO_STATUSES_ALLOW_INVOICE = [
  'APPROVED',
  'SENT',
  'ORDERED',
  'SENT_TO_SUPPLIER',
] as const;

const INVOICE_STATUS_LIST: PurchaseInvoiceStatus[] = [
  'PENDING',
  'MATCHED',
  'DISCREPANCY',
  'PAID',
];

/** Vencimiento por defecto: 30 días después de la fecha de emisión. */
function defaultDueDateFromEmission(emission: Date): Date {
  const d = new Date(emission.getTime());
  d.setUTCDate(d.getUTCDate() + 30);
  return d;
}

function addUtcDays(base: Date, days: number): Date {
  const d = new Date(base.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

/** Fecha de vencimiento para calendario y filtros: guardada o emisión + 30 días. */
function effectiveDueForCalendar(inv: {
  dueDate: Date | null;
  emissionDate: Date;
}): Date {
  if (inv.dueDate != null) return inv.dueDate;
  return defaultDueDateFromEmission(inv.emissionDate);
}

type InvoiceEntity = Prisma.PurchaseInvoiceGetPayload<{
  include: {
    vendor: { select: { id: true; name: true; code: true } };
    purchaseOrder: {
      select: {
        id: true;
        correlative: true;
        totalAmount: true;
        status: true;
        contractId: true;
      };
    };
  };
}>;

export type PurchaseInvoiceApi = InvoiceEntity & {
  hasDiscrepancy: boolean;
  discrepancyReason: string;
  /** Adjuntos unificados (PDF, imágenes, etc.). */
  purchaseDocuments?: Array<{
    id: string;
    storageKey: string;
    originalName: string;
    mimeType: string;
    sizeBytes: number;
    createdAt: Date;
    uploadedBy: { id: string; name: string; email: string | null };
  }>;
};

@Injectable()
export class PurchaseInvoicesService {
  private readonly logger = new Logger(PurchaseInvoicesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  /** Valor recibido en bodega (recepciones confirmadas o parciales), por línea: cantidad × costo unitario OC. */
  async computeReceivedAmountForPurchaseOrder(
    purchaseOrderId: string,
  ): Promise<Prisma.Decimal> {
    const receipts = await this.prisma.warehouseReceipt.findMany({
      where: {
        purchaseOrderId,
        status: { in: ['PARTIAL', 'COMPLETED'] },
      },
      include: {
        items: { include: { orderItem: true } },
      },
    });

    let total = new Prisma.Decimal(0);
    for (const r of receipts) {
      for (const line of r.items) {
        const qty = new Prisma.Decimal(line.quantityReceived);
        const unit = new Prisma.Decimal(line.orderItem.unitCost);
        total = total.add(qty.mul(unit));
      }
    }
    return total;
  }

  private async fetchDiscrepancyReasonsMap(
    tenantId: string,
    invoiceIds: string[],
  ): Promise<Map<string, string>> {
    if (!invoiceIds.length) return new Map();
    const logs = await this.prisma.activityLog.findMany({
      where: {
        tenantId,
        entityType: 'PURCHASE_INVOICE',
        entityId: { in: invoiceIds },
      },
      orderBy: { createdAt: 'desc' },
      select: { entityId: true, details: true },
    });
    const map = new Map<string, string>();
    for (const log of logs) {
      const nv = log.details as {
        newValue?: { event?: string; reasons?: string[] };
      };
      if (nv?.newValue?.event !== 'invoice_three_way_match_discrepancy') {
        continue;
      }
      if (map.has(log.entityId)) continue;
      map.set(log.entityId, (nv.newValue.reasons ?? []).join(' · '));
    }
    return map;
  }

  private async attachInvoiceMeta(
    inv: InvoiceEntity,
    tenantId: string,
    prefetch?: Map<string, string>,
  ): Promise<PurchaseInvoiceApi> {
    let discrepancyReason = '';
    if (inv.status === 'DISCREPANCY') {
      if (prefetch?.has(inv.id)) {
        discrepancyReason = prefetch.get(inv.id)!;
      } else {
        const m = await this.fetchDiscrepancyReasonsMap(tenantId, [inv.id]);
        discrepancyReason = m.get(inv.id) ?? '';
      }
    }
    return {
      ...inv,
      hasDiscrepancy: inv.status === 'DISCREPANCY',
      discrepancyReason,
    };
  }

  /**
   * Push inmediato: ADMIN, SUPER_ADMIN y roles de tenant con "Finanzas"/"Contabilidad"
   * en nombre o descripción, con acceso al contrato de la OC.
   */
  private async notifyInvoiceDiscrepancy(params: {
    tenantId: string;
    contractId: string;
    invoiceId: string;
    invoiceNumber: string;
    purchaseOrderId: string;
    purchaseOrderCorrelative: string;
  }): Promise<void> {
    const financeRoleMatch: Prisma.TenantRoleWhereInput = {
      tenantId: params.tenantId,
      OR: [
        { name: { contains: 'Finanzas', mode: 'insensitive' } },
        { name: { contains: 'Contabilidad', mode: 'insensitive' } },
        { description: { contains: 'Finanzas', mode: 'insensitive' } },
        { description: { contains: 'Contabilidad', mode: 'insensitive' } },
      ],
    };

    const recipients = await this.prisma.user.findMany({
      where: {
        tenantId: params.tenantId,
        isActive: true,
        OR: [
          { role: 'ADMIN' },
          { role: 'SUPER_ADMIN' },
          {
            customRole: financeRoleMatch,
            contractAccess: { some: { contractId: params.contractId } },
          },
        ],
      },
      select: { id: true },
    });

    const title = `⚠️ Discrepancia en Factura: ${params.invoiceNumber}`;
    const body = `El monto facturado no coincide con la Orden de Compra ${params.purchaseOrderCorrelative} o lo recibido en bodega.`;
    const data: Record<string, string> = {
      orderId: params.purchaseOrderId,
      invoiceId: params.invoiceId,
      type: 'INVOICE_DISCREPANCY',
    };

    await Promise.all(
      recipients.map((u) =>
        this.notifications.sendNotification(u.id, title, body, data),
      ),
    );
  }

  private invoiceInclude() {
    return {
      vendor: { select: { id: true, name: true, code: true } as const },
      purchaseOrder: {
        select: {
          id: true,
          correlative: true,
          totalAmount: true,
          status: true,
          contractId: true,
        } as const,
      },
    };
  }

  /** Filtro de OC según contrato explícito o permisos del usuario. */
  private purchaseOrderScopeWhere(
    user: { role?: string; allowedContracts?: string[] },
    contractId?: string,
  ): Prisma.PurchaseOrderWhereInput {
    const cid = contractId?.trim();
    if (cid) {
      return { contractId: cid };
    }
    if (user.role === 'ADMIN' || user.role === 'SUPER_ADMIN') {
      return {};
    }
    const allowed = user.allowedContracts ?? [];
    if (allowed.includes('ALL')) {
      return {};
    }
    if (!allowed.length) {
      return { contractId: '00000000-0000-4000-8000-000000000001' };
    }
    return { contractId: { in: allowed } };
  }

  /**
   * Lista global de facturas (submódulo). Filtros opcionales: `status`, `contractId`, `dueDateFrom`, `dueDateTo`.
   */
  async findAll(
    user: { tenantId: string; role?: string; allowedContracts?: string[] },
    status?: string,
    contractId?: string,
    dueDateFrom?: string,
    dueDateTo?: string,
  ): Promise<PurchaseInvoiceApi[]> {
    if (
      status !== undefined &&
      status !== '' &&
      !INVOICE_STATUS_LIST.includes(status as PurchaseInvoiceStatus)
    ) {
      throw new BadRequestException(
        `status inválido. Use: ${INVOICE_STATUS_LIST.join(', ')}`,
      );
    }
    const df = dueDateFrom?.trim()
      ? this.extractIsoDateOrThrow(dueDateFrom, 'dueDateFrom')
      : undefined;
    const dt = dueDateTo?.trim()
      ? this.extractIsoDateOrThrow(dueDateTo, 'dueDateTo')
      : undefined;
    if (df && dt && df > dt) {
      throw new BadRequestException(
        'dueDateFrom debe ser anterior o igual a dueDateTo.',
      );
    }
    const rangeStart = df ? new Date(`${df}T00:00:00.000Z`) : undefined;
    const rangeEnd = dt ? new Date(`${dt}T23:59:59.999Z`) : undefined;

    /** Incluye facturas con dueDate null cuyo vencimiento efectivo puede caer en el rango (emisión ± margen). */
    const dueRangeWhere: Prisma.PurchaseInvoiceWhereInput | undefined =
      df || dt
        ? {
            OR: [
              {
                dueDate: {
                  not: null,
                  ...(rangeStart ? { gte: rangeStart } : {}),
                  ...(rangeEnd ? { lte: rangeEnd } : {}),
                },
              },
              {
                dueDate: null,
                emissionDate: {
                  ...(rangeStart ? { gte: addUtcDays(rangeStart, -40) } : {}),
                  ...(rangeEnd ? { lte: addUtcDays(rangeEnd, -20) } : {}),
                },
              },
            ],
          }
        : undefined;

    const poWhere = this.purchaseOrderScopeWhere(user, contractId);
    const rowsRaw = await this.prisma.purchaseInvoice.findMany({
      where: {
        tenantId: user.tenantId,
        ...(status ? { status: status as PurchaseInvoiceStatus } : {}),
        ...(dueRangeWhere ?? {}),
        purchaseOrder: poWhere,
      },
      include: this.invoiceInclude(),
      orderBy: [{ emissionDate: 'desc' }, { createdAt: 'desc' }],
      take: 1000,
    });
    const rows =
      df || dt
        ? rowsRaw.filter((r) => {
            const eff = effectiveDueForCalendar(r);
            if (rangeStart && eff < rangeStart) return false;
            if (rangeEnd && eff > rangeEnd) return false;
            return true;
          })
        : rowsRaw;
    const discIds = rows
      .filter((r) => r.status === 'DISCREPANCY')
      .map((r) => r.id);
    const reasonMap = await this.fetchDiscrepancyReasonsMap(
      user.tenantId,
      discIds,
    );
    return Promise.all(
      rows.map((r) => this.attachInvoiceMeta(r, user.tenantId, reasonMap)),
    );
  }

  private async loadInvoiceEntity(
    id: string,
    tenantId: string,
  ): Promise<InvoiceEntity> {
    const inv = await this.prisma.purchaseInvoice.findFirst({
      where: { id, tenantId },
      include: this.invoiceInclude(),
    });
    if (!inv) throw new NotFoundException('Factura no encontrada');
    return inv;
  }

  /** Detalle para API: aislamiento contractual + metadata. */
  async findByIdForApi(
    id: string,
    user: { tenantId: string; role?: string; allowedContracts?: string[] },
  ): Promise<PurchaseInvoiceApi> {
    const [inv, purchaseDocuments] = await Promise.all([
      this.loadInvoiceEntity(id, user.tenantId),
      this.prisma.purchaseDocument.findMany({
        where: {
          tenantId: user.tenantId,
          entity: 'PURCHASE_INVOICE',
          entityId: id,
        },
        orderBy: { createdAt: 'desc' },
        include: {
          uploadedBy: { select: { id: true, name: true, email: true } },
        },
      }),
    ]);
    assertUserHasContractAccess(user, inv.purchaseOrder.contractId);
    const meta = await this.attachInvoiceMeta(inv, user.tenantId);
    return { ...meta, purchaseDocuments };
  }

  /**
   * 3-way match: total factura vs OC (margen %) y vs valor recepciones (no facturar por encima de lo recibido).
   */
  async validateInvoiceMatch(
    invoiceId: string,
    tenantId: string,
    userId: string,
  ) {
    const invoice = await this.prisma.purchaseInvoice.findFirst({
      where: { id: invoiceId, tenantId },
      include: {
        purchaseOrder: true,
        vendor: { select: { id: true, name: true, code: true } },
      },
    });
    if (!invoice) throw new NotFoundException('Factura no encontrada');
    if (invoice.status === 'PAID') {
      throw new BadRequestException(
        'No se puede revalidar una factura ya marcada como pagada.',
      );
    }

    const settings = await this.prisma.purchaseSettings.findUnique({
      where: { tenantId },
    });
    const tolPct = settings?.invoiceMatchTolerancePercent
      ? new Prisma.Decimal(settings.invoiceMatchTolerancePercent).toNumber()
      : 1;
    const tol = tolPct / 100;

    const poAmount = new Prisma.Decimal(invoice.purchaseOrder.totalAmount);
    const invAmount = new Prisma.Decimal(invoice.totalAmount);
    const receivedAmount = await this.computeReceivedAmountForPurchaseOrder(
      invoice.purchaseOrderId,
    );

    const poNum = poAmount.toNumber();
    const invNum = invAmount.toNumber();
    const recNum = receivedAmount.toNumber();

    const diffPo = Math.abs(invNum - poNum);
    const poMargin = Math.abs(poNum) * tol;
    const matchPo = poNum === 0 ? invNum === 0 : diffPo <= poMargin;

    const recMargin = Math.abs(recNum) * tol;
    const matchReceived = invNum <= recNum + recMargin;

    const reasons: string[] = [];
    if (!matchPo) {
      reasons.push(
        `El monto de la factura (${invNum.toFixed(2)}) no coincide con el de la OC (${poNum.toFixed(2)}) dentro del margen del ${tolPct}%.`,
      );
    }
    if (!matchReceived) {
      reasons.push(
        `El monto facturado (${invNum.toFixed(2)}) supera el valor recepcionado acumulado (${recNum.toFixed(2)}); no se puede reconocer pago por bienes no ingresados a bodega.`,
      );
    }

    /** Exposición para prevención de sobrepagos (analítica / auditoría). */
    const overpaymentExposureAmount = Math.max(
      0,
      invNum - Math.min(poNum, recNum),
    );

    const newStatus =
      matchPo && matchReceived
        ? ('MATCHED' as const)
        : ('DISCREPANCY' as const);

    const previousStatus = invoice.status;
    const auditMessage = `Prevención de sobrepaso detectada: ${overpaymentExposureAmount.toFixed(2)}`;

    const updated = await this.prisma.$transaction(async (tx) => {
      const inv = await tx.purchaseInvoice.update({
        where: { id: invoiceId },
        data: { status: newStatus },
        include: this.invoiceInclude(),
      });

      if (newStatus === 'DISCREPANCY') {
        await tx.activityLog.create({
          data: {
            tenantId,
            userId,
            action: 'STATUS_CHANGE',
            entityType: 'PURCHASE_INVOICE',
            entityId: invoice.id,
            details: buildActivityLogDetails(
              { status: previousStatus },
              {
                status: newStatus,
                event: 'invoice_three_way_match_discrepancy',
                message: auditMessage,
                invoiceId: invoice.id,
                invoiceNumber: invoice.invoiceNumber,
                purchaseOrderId: invoice.purchaseOrderId,
                purchaseOrderCorrelative: invoice.purchaseOrder.correlative,
                previousStatus,
                poAmount: poNum,
                invoiceAmount: invNum,
                receivedAmount: recNum,
                tolerancePercent: tolPct,
                matchPo,
                matchReceived,
                overpaymentExposureAmount,
                reasons,
              },
              {
                field: 'status',
                prev: previousStatus,
                next: newStatus,
                metadata: {
                  invoiceNumber: invoice.invoiceNumber,
                  purchaseOrderId: invoice.purchaseOrderId,
                  purchaseOrderCorrelative: invoice.purchaseOrder.correlative,
                },
              },
            ),
          },
        });
      }

      if (newStatus === 'MATCHED' && previousStatus === 'DISCREPANCY') {
        let priorInvoiceFromDiscrepancy: number | null = null;
        const recentLogs = await tx.activityLog.findMany({
          where: {
            tenantId,
            entityType: 'PURCHASE_INVOICE',
            entityId: invoice.id,
          },
          orderBy: { createdAt: 'desc' },
          take: 30,
          select: { details: true },
        });
        for (const row of recentLogs) {
          const d = row.details as {
            newValue?: { event?: string; invoiceAmount?: number };
          };
          if (d?.newValue?.event === 'invoice_three_way_match_discrepancy') {
            const v = d.newValue.invoiceAmount;
            priorInvoiceFromDiscrepancy =
              typeof v === 'number' ? v : v != null ? Number(v) : null;
            break;
          }
        }
        const overpaymentPreventionAmount =
          priorInvoiceFromDiscrepancy != null
            ? Math.max(0, priorInvoiceFromDiscrepancy - invNum)
            : 0;

        await tx.activityLog.create({
          data: {
            tenantId,
            userId,
            action: 'STATUS_CHANGE',
            entityType: 'PURCHASE_INVOICE',
            entityId: invoice.id,
            details: buildActivityLogDetails(
              { status: previousStatus },
              {
                status: newStatus,
                event: 'invoice_three_way_match_resolved',
                invoiceId: invoice.id,
                purchaseOrderId: invoice.purchaseOrderId,
                poAmount: poNum,
                invoiceAmount: invNum,
                receivedAmount: recNum,
                priorInvoiceAmountFromDiscrepancy: priorInvoiceFromDiscrepancy,
                overpaymentPreventionAmount,
              },
              {
                field: 'status',
                prev: previousStatus,
                next: newStatus,
                metadata: {
                  invoiceNumber: invoice.invoiceNumber,
                  purchaseOrderId: invoice.purchaseOrderId,
                },
              },
            ),
          },
        });
      }

      return inv;
    });

    if (newStatus === 'DISCREPANCY') {
      this.notifyInvoiceDiscrepancy({
        tenantId,
        contractId: invoice.purchaseOrder.contractId,
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        purchaseOrderId: invoice.purchaseOrderId,
        purchaseOrderCorrelative: invoice.purchaseOrder.correlative,
      }).catch((err) =>
        this.logger.warn(
          `No se pudo enviar push por discrepancia de factura ${invoice.id}: ${String(err)}`,
        ),
      );
    }

    const enriched = await this.attachInvoiceMeta(updated, tenantId);

    const poLink = await this.prisma.purchaseOrder.findFirst({
      where: { id: invoice.purchaseOrderId, tenantId },
      select: {
        requisitionId: true,
        quotation: { select: { requisitionId: true } },
      },
    });
    const rid = requisitionIdFromPurchaseOrder(poLink);
    if (rid) {
      void tryAutoCloseRequisitionIfFullyReconciled(
        this.prisma,
        tenantId,
        rid,
        userId,
      ).catch((e) =>
        this.logger.warn(`Auto-cierre SRC tras factura/3-way: ${String(e)}`),
      );
    }

    return {
      ...enriched,
      match: {
        poAmount: poNum,
        invoiceAmount: invNum,
        receivedAmount: recNum,
        tolerancePercent: tolPct,
        matchPo,
        matchReceived,
        reasons,
      },
    };
  }

  async create(
    data: {
      purchaseOrderId: string;
      vendorId: string;
      invoiceNumber: string;
      emissionDate: string;
      dueDate?: string;
      totalAmount: number;
      netAmount?: number | null;
      taxAmount?: number | null;
      pdfUrl?: string | null;
    },
    user: {
      id: string;
      tenantId: string;
      role?: string;
      allowedContracts?: string[];
    },
  ) {
    const tenantId = user.tenantId;

    const order = await this.prisma.purchaseOrder.findFirst({
      where: { id: data.purchaseOrderId, tenantId },
      include: {
        quotation: { select: { vendorId: true } },
        purchaseInvoice: { select: { id: true } },
      },
    });

    if (!order) throw new NotFoundException('Orden de compra no encontrada');
    assertUserHasContractAccess(user, order.contractId);

    if (!PO_STATUSES_ALLOW_INVOICE.includes(order.status as any)) {
      throw new BadRequestException(
        'Solo se puede registrar factura si la OC está en estado APROBADA o ENVIADA AL PROVEEDOR.',
      );
    }

    if (order.purchaseInvoice) {
      throw new BadRequestException(
        'Esta orden ya tiene una factura registrada (relación 1:1).',
      );
    }

    const expectedVendorId = order.quotation?.vendorId;
    if (!expectedVendorId) {
      throw new BadRequestException(
        'La orden no tiene cotización asociada; no se puede registrar factura.',
      );
    }
    if (data.vendorId !== expectedVendorId) {
      throw new BadRequestException(
        'El proveedor de la factura debe coincidir con el de la cotización adjudicada.',
      );
    }

    const emission = new Date(data.emissionDate);
    if (Number.isNaN(emission.getTime())) {
      throw new BadRequestException('emissionDate inválida.');
    }
    let dueDate: Date;
    if (data.dueDate != null && String(data.dueDate).trim() !== '') {
      dueDate = new Date(data.dueDate);
      if (Number.isNaN(dueDate.getTime())) {
        throw new BadRequestException('dueDate inválida.');
      }
    } else {
      dueDate = defaultDueDateFromEmission(emission);
    }

    const invoice = await this.prisma.purchaseInvoice.create({
      data: {
        tenantId,
        vendorId: data.vendorId,
        purchaseOrderId: data.purchaseOrderId,
        invoiceNumber: data.invoiceNumber.trim(),
        emissionDate: emission,
        dueDate,
        totalAmount: new Prisma.Decimal(data.totalAmount),
        netAmount:
          data.netAmount != null && !Number.isNaN(Number(data.netAmount))
            ? new Prisma.Decimal(data.netAmount)
            : null,
        taxAmount:
          data.taxAmount != null && !Number.isNaN(Number(data.taxAmount))
            ? new Prisma.Decimal(data.taxAmount)
            : null,
        pdfUrl: data.pdfUrl ?? null,
        status: 'PENDING',
      },
    });

    const vendor = await this.prisma.vendor.findFirst({
      where: { id: data.vendorId, tenantId },
      select: { name: true, code: true },
    });

    await this.audit.log({
      userId: user.id,
      tenantId,
      entityType: 'PURCHASE_INVOICE',
      entityId: invoice.id,
      action: ActivityAction.CREATE,
      newValue: {
        event: 'invoice_created',
        invoiceNumber: invoice.invoiceNumber,
        totalAmount: Number(invoice.totalAmount),
        vendorName: vendor?.name ?? '',
        vendorCode: vendor?.code ?? '',
        emissionDate: invoice.emissionDate.toISOString(),
        dueDate: invoice.dueDate?.toISOString() ?? null,
        status: invoice.status,
      },
      unified: {
        metadata: {
          purchaseOrderId: data.purchaseOrderId,
          purchaseOrderCorrelative: order.correlative,
          invoiceNumber: invoice.invoiceNumber,
          invoiceId: invoice.id,
          vendorName: vendor?.name ?? '',
        },
      },
    });

    return this.validateInvoiceMatch(invoice.id, tenantId, user.id);
  }

  async update(
    id: string,
    data: {
      invoiceNumber?: string;
      emissionDate?: string;
      dueDate?: string | null;
      totalAmount?: number;
      netAmount?: number | null;
      taxAmount?: number | null;
      pdfUrl?: string | null;
    },
    user: {
      id: string;
      tenantId: string;
      role?: string;
      allowedContracts?: string[];
    },
  ) {
    const existing = await this.loadInvoiceEntity(id, user.tenantId);
    if (existing.status === 'PAID') {
      throw new BadRequestException(
        'No se puede editar una factura marcada como pagada.',
      );
    }

    const order = await this.prisma.purchaseOrder.findFirst({
      where: { id: existing.purchaseOrderId, tenantId: user.tenantId },
      select: { contractId: true },
    });
    if (order) assertUserHasContractAccess(user, order.contractId);

    const hasChange =
      data.invoiceNumber !== undefined ||
      data.emissionDate !== undefined ||
      data.dueDate !== undefined ||
      data.totalAmount !== undefined ||
      data.netAmount !== undefined ||
      data.taxAmount !== undefined ||
      data.pdfUrl !== undefined;
    if (!hasChange) {
      throw new BadRequestException('No se recibieron campos para actualizar.');
    }

    const updateData: Prisma.PurchaseInvoiceUpdateInput = { status: 'PENDING' };
    if (data.invoiceNumber !== undefined) {
      updateData.invoiceNumber = data.invoiceNumber.trim();
    }
    if (data.emissionDate !== undefined) {
      updateData.emissionDate = new Date(data.emissionDate);
    }
    if (data.dueDate !== undefined) {
      if (data.dueDate === null || String(data.dueDate).trim() === '') {
        updateData.dueDate = null;
      } else {
        const d = new Date(data.dueDate);
        if (Number.isNaN(d.getTime())) {
          throw new BadRequestException('dueDate inválida.');
        }
        updateData.dueDate = d;
      }
    }
    if (data.totalAmount !== undefined) {
      updateData.totalAmount = new Prisma.Decimal(data.totalAmount);
    }
    if (data.netAmount !== undefined) {
      updateData.netAmount =
        data.netAmount == null ? null : new Prisma.Decimal(data.netAmount);
    }
    if (data.taxAmount !== undefined) {
      updateData.taxAmount =
        data.taxAmount == null ? null : new Prisma.Decimal(data.taxAmount);
    }
    if (data.pdfUrl !== undefined) {
      updateData.pdfUrl = data.pdfUrl;
    }

    const beforeSnap: Record<string, unknown> = {
      invoiceNumber: existing.invoiceNumber,
      emissionDate: existing.emissionDate.toISOString(),
      dueDate: existing.dueDate?.toISOString() ?? null,
      totalAmount: Number(existing.totalAmount),
      netAmount: existing.netAmount != null ? Number(existing.netAmount) : null,
      taxAmount: existing.taxAmount != null ? Number(existing.taxAmount) : null,
      pdfUrl: existing.pdfUrl,
    };

    await this.prisma.purchaseInvoice.update({
      where: { id },
      data: updateData,
    });

    const fresh = await this.loadInvoiceEntity(id, user.tenantId);
    const afterSnap: Record<string, unknown> = {
      invoiceNumber: fresh.invoiceNumber,
      emissionDate: fresh.emissionDate.toISOString(),
      dueDate: fresh.dueDate?.toISOString() ?? null,
      totalAmount: Number(fresh.totalAmount),
      netAmount: fresh.netAmount != null ? Number(fresh.netAmount) : null,
      taxAmount: fresh.taxAmount != null ? Number(fresh.taxAmount) : null,
      pdfUrl: fresh.pdfUrl,
    };

    const { oldValue, newValue } = pickChanged(beforeSnap, afterSnap);
    const meta = {
      purchaseOrderId: fresh.purchaseOrderId,
      purchaseOrderCorrelative: fresh.purchaseOrder.correlative,
      invoiceNumber: fresh.invoiceNumber,
      invoiceId: id,
    };

    for (const key of Object.keys(oldValue)) {
      const prev = oldValue[key];
      const next = newValue[key];
      await this.audit.log({
        userId: user.id,
        tenantId: user.tenantId,
        entityType: 'PURCHASE_INVOICE',
        entityId: id,
        action: ActivityAction.UPDATE,
        oldValue: { [key]: prev },
        newValue: { [key]: next },
        unified: {
          field: key,
          prev,
          next,
          metadata: meta,
        },
      });
    }

    return this.validateInvoiceMatch(id, user.tenantId, user.id);
  }

  async markPaid(
    id: string,
    user: {
      id: string;
      tenantId: string;
      role?: string;
      allowedContracts?: string[];
    },
  ) {
    const existing = await this.loadInvoiceEntity(id, user.tenantId);
    if (existing.status !== 'MATCHED') {
      throw new BadRequestException(
        'Solo se puede marcar como pagada una factura con match 3-way OK (MATCHED).',
      );
    }

    const order = await this.prisma.purchaseOrder.findFirst({
      where: { id: existing.purchaseOrderId, tenantId: user.tenantId },
      select: { contractId: true },
    });
    if (order) assertUserHasContractAccess(user, order.contractId);

    const prevStatus = existing.status;
    const paidAt = new Date();
    const updated = await this.prisma.purchaseInvoice.update({
      where: { id },
      data: { status: 'PAID', paidAt },
      include: this.invoiceInclude(),
    });

    await this.audit.log({
      userId: user.id,
      tenantId: user.tenantId,
      entityType: 'PURCHASE_INVOICE',
      entityId: id,
      action: ActivityAction.STATUS_CHANGE,
      oldValue: { status: prevStatus },
      newValue: {
        status: 'PAID',
        paidAt: paidAt.toISOString(),
      },
      unified: {
        field: 'status',
        prev: prevStatus,
        next: 'PAID',
        metadata: {
          purchaseOrderId: existing.purchaseOrderId,
          purchaseOrderCorrelative: existing.purchaseOrder.correlative,
          invoiceNumber: existing.invoiceNumber,
          invoiceId: id,
        },
      },
    });

    return this.attachInvoiceMeta(updated, user.tenantId);
  }

  /**
   * Registra pago con referencia (transferencia, número de comprobante, etc.).
   */
  async recordPayment(
    id: string,
    paymentReference: string,
    user: {
      id: string;
      tenantId: string;
      role?: string;
      allowedContracts?: string[];
    },
  ) {
    const ref = paymentReference?.trim();
    if (!ref) {
      throw new BadRequestException('paymentReference es obligatorio.');
    }

    const existing = await this.loadInvoiceEntity(id, user.tenantId);
    if (existing.status !== 'MATCHED') {
      throw new BadRequestException(
        'Solo se puede registrar pago de una factura con validación 3-way OK (MATCHED).',
      );
    }

    const order = await this.prisma.purchaseOrder.findFirst({
      where: { id: existing.purchaseOrderId, tenantId: user.tenantId },
      select: { contractId: true },
    });
    if (order) assertUserHasContractAccess(user, order.contractId);

    const prevStatus = existing.status;
    const paidAt = new Date();
    const updated = await this.prisma.purchaseInvoice.update({
      where: { id },
      data: {
        status: 'PAID',
        paidAt,
        paymentReference: ref,
      },
      include: this.invoiceInclude(),
    });

    await this.audit.log({
      userId: user.id,
      tenantId: user.tenantId,
      entityType: 'PURCHASE_INVOICE',
      entityId: id,
      action: ActivityAction.STATUS_CHANGE,
      oldValue: { status: prevStatus },
      newValue: {
        status: 'PAID',
        paidAt: paidAt.toISOString(),
        paymentReference: ref,
      },
      unified: {
        field: 'status',
        prev: prevStatus,
        next: 'PAID',
        metadata: {
          purchaseOrderId: existing.purchaseOrderId,
          purchaseOrderCorrelative: existing.purchaseOrder.correlative,
          invoiceNumber: existing.invoiceNumber,
          invoiceId: id,
          paymentReference: ref,
        },
      },
    });

    return this.attachInvoiceMeta(updated, user.tenantId);
  }

  /**
   * Elimina factura no pagada (p. ej. corrección total del documento).
   */
  async remove(
    id: string,
    user: {
      id: string;
      tenantId: string;
      role?: string;
      allowedContracts?: string[];
    },
  ) {
    const existing = await this.loadInvoiceEntity(id, user.tenantId);
    if (existing.status === 'PAID') {
      throw new BadRequestException(
        'No se puede eliminar una factura ya marcada como pagada.',
      );
    }

    const order = await this.prisma.purchaseOrder.findFirst({
      where: { id: existing.purchaseOrderId, tenantId: user.tenantId },
      select: { contractId: true },
    });
    if (order) assertUserHasContractAccess(user, order.contractId);

    await this.audit.log({
      userId: user.id,
      tenantId: user.tenantId,
      entityType: 'PURCHASE_INVOICE',
      entityId: id,
      action: ActivityAction.DELETE,
      oldValue: {
        invoiceNumber: existing.invoiceNumber,
        totalAmount: Number(existing.totalAmount),
        vendorName: existing.vendor.name,
        vendorCode: existing.vendor.code,
        status: existing.status,
        emissionDate: existing.emissionDate.toISOString(),
      },
      unified: {
        metadata: {
          purchaseOrderId: existing.purchaseOrderId,
          purchaseOrderCorrelative: existing.purchaseOrder.correlative,
          invoiceNumber: existing.invoiceNumber,
          invoiceId: id,
          event: 'invoice_deleted',
        },
      },
    });

    await this.prisma.purchaseInvoice.delete({ where: { id } });
  }

  /**
   * Totales diarios por fecha de vencimiento (facturas no pagadas con vencimiento en rango).
   * Incluye PENDING (aún sin validar 3-way), MATCHED y DISCREPANCY; excluye PAID.
   */
  async getPaymentCalendar(
    user: { tenantId: string; role?: string; allowedContracts?: string[] },
    fromStr: string,
    toStr: string,
    contractId: string,
  ): Promise<
    Array<{
      date: string;
      matchedTotal: number;
      discrepancyTotal: number;
      pendingTotal: number;
      matchedCount: number;
      discrepancyCount: number;
      pendingCount: number;
    }>
  > {
    const fromDay = this.extractIsoDateOrThrow(fromStr, 'from');
    const toDay = this.extractIsoDateOrThrow(toStr, 'to');
    if (fromDay > toDay) {
      throw new BadRequestException('from debe ser anterior o igual a to.');
    }

    const rangeStart = new Date(`${fromDay}T00:00:00.000Z`);
    const rangeEnd = new Date(`${toDay}T23:59:59.999Z`);

    const rows = await this.prisma.purchaseInvoice.findMany({
      where: {
        tenantId: user.tenantId,
        status: { in: ['PENDING', 'MATCHED', 'DISCREPANCY'] },
        purchaseOrder: { contractId },
        OR: [
          {
            dueDate: {
              not: null,
              gte: rangeStart,
              lte: rangeEnd,
            },
          },
          {
            dueDate: null,
            emissionDate: {
              gte: addUtcDays(rangeStart, -40),
              lte: addUtcDays(rangeEnd, -20),
            },
          },
        ],
      },
      select: {
        dueDate: true,
        emissionDate: true,
        totalAmount: true,
        status: true,
      },
    });

    type DayAgg = {
      matched: Prisma.Decimal;
      discrepancy: Prisma.Decimal;
      pending: Prisma.Decimal;
      matchedCount: number;
      discrepancyCount: number;
      pendingCount: number;
    };
    const zero = () => ({
      matched: new Prisma.Decimal(0),
      discrepancy: new Prisma.Decimal(0),
      pending: new Prisma.Decimal(0),
      matchedCount: 0,
      discrepancyCount: 0,
      pendingCount: 0,
    });

    const byDay = new Map<string, DayAgg>();
    for (const r of rows) {
      const eff = effectiveDueForCalendar(r);
      if (
        eff.getTime() < rangeStart.getTime() ||
        eff.getTime() > rangeEnd.getTime()
      ) {
        continue;
      }
      const key = eff.toISOString().slice(0, 10);
      const prev = byDay.get(key) ?? zero();
      if (r.status === 'MATCHED') {
        prev.matched = prev.matched.add(r.totalAmount);
        prev.matchedCount += 1;
      } else if (r.status === 'DISCREPANCY') {
        prev.discrepancy = prev.discrepancy.add(r.totalAmount);
        prev.discrepancyCount += 1;
      } else if (r.status === 'PENDING') {
        prev.pending = prev.pending.add(r.totalAmount);
        prev.pendingCount += 1;
      }
      byDay.set(key, prev);
    }

    const out: Array<{
      date: string;
      matchedTotal: number;
      discrepancyTotal: number;
      pendingTotal: number;
      matchedCount: number;
      discrepancyCount: number;
      pendingCount: number;
    }> = [];

    const cursor = new Date(`${fromDay}T12:00:00.000Z`);
    const end = new Date(`${toDay}T12:00:00.000Z`);
    while (cursor.getTime() <= end.getTime()) {
      const key = cursor.toISOString().slice(0, 10);
      const agg = byDay.get(key);
      out.push({
        date: key,
        matchedTotal: agg ? agg.matched.toNumber() : 0,
        discrepancyTotal: agg ? agg.discrepancy.toNumber() : 0,
        pendingTotal: agg ? agg.pending.toNumber() : 0,
        matchedCount: agg?.matchedCount ?? 0,
        discrepancyCount: agg?.discrepancyCount ?? 0,
        pendingCount: agg?.pendingCount ?? 0,
      });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    return out;
  }

  /** Espera YYYY-MM-DD (inicio de cadena ISO). */
  private extractIsoDateOrThrow(s: string, label: string): string {
    const t = s?.trim() ?? '';
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(t);
    if (!m) {
      throw new BadRequestException(
        `${label}: use una fecha en formato YYYY-MM-DD.`,
      );
    }
    return m[1];
  }
}
