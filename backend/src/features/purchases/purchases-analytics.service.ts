import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  generatePurchasesAnalyticsReportPdfBuffer,
  type PurchasesAnalyticsDashboardPdfData,
} from './purchases-analytics-report-pdf.generator';

/** Estados en los que la OC ya fue aprobada para compra / ejecución. */
const APPROVED_SPEND_STATUSES: Prisma.PurchaseOrderWhereInput['status'] = {
  in: [
    'APPROVED',
    'SENT',
    'ORDERED',
    'SENT_TO_SUPPLIER',
    'PARTIALLY_RECEIVED',
    'RECEIVED',
    'CLOSED',
  ],
};

const CRITICAL_AMOUNT = new Prisma.Decimal(5_000_000);

@Injectable()
export class PurchasesAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboard(
    tenantId: string,
    query: {
      contractId?: string;
      from?: string;
      to?: string;
      /** Por defecto true: el embudo no cuenta SRC en estado CLOSED (historial). */
      excludeClosedRequisitions?: boolean;
    },
  ) {
    const to = query.to ? new Date(query.to) : new Date();
    const from = query.from
      ? new Date(query.from)
      : new Date(to.getTime() - 365 * 24 * 60 * 60 * 1000);
    const contractId = query.contractId;
    const excludeClosedRequisitions = query.excludeClosedRequisitions !== false;

    const poBase: Prisma.PurchaseOrderWhereInput = {
      tenantId,
      ...(contractId ? { contractId } : {}),
    };

    const poInRange: Prisma.PurchaseOrderWhereInput = {
      ...poBase,
      createdAt: { gte: from, lte: to },
    };

    const [
      totalApprovedSpend,
      pendingSignatureCount,
      spendGeneral,
      spendEquipment,
      spendWorkOrder,
      criticalOrdersRaw,
      invoiceStats,
      overpaymentRow,
      monthlyRows,
      vendorRows,
      multiproviderSavings,
      requisitionPipeline,
      partialRequisitionPurchaseProgress,
      requisitionPurchaseRows,
    ] = await Promise.all([
      this.prisma.purchaseOrder.aggregate({
        where: {
          ...poInRange,
          status: APPROVED_SPEND_STATUSES,
        },
        _sum: { totalAmount: true },
      }),
      this.prisma.purchaseOrder.count({
        where: {
          ...poBase,
          status: { in: ['PENDING_APPROVAL', 'PARTIALLY_APPROVED'] },
        },
      }),
      this.prisma.purchaseOrder.aggregate({
        where: {
          ...poInRange,
          status: APPROVED_SPEND_STATUSES,
          workOrderId: null,
          equipmentId: null,
        },
        _sum: { totalAmount: true },
      }),
      this.prisma.purchaseOrder.aggregate({
        where: {
          ...poInRange,
          status: APPROVED_SPEND_STATUSES,
          workOrderId: null,
          equipmentId: { not: null },
        },
        _sum: { totalAmount: true },
      }),
      this.prisma.purchaseOrder.aggregate({
        where: {
          ...poInRange,
          status: APPROVED_SPEND_STATUSES,
          workOrderId: { not: null },
        },
        _sum: { totalAmount: true },
      }),
      this.prisma.purchaseOrder.findMany({
        where: {
          ...poBase,
          totalAmount: { gt: CRITICAL_AMOUNT },
          status: { in: ['PENDING_APPROVAL', 'PARTIALLY_APPROVED'] },
          createdAt: {
            lte: new Date(Date.now() - 48 * 60 * 60 * 1000),
          },
        },
        select: {
          id: true,
          correlative: true,
          totalAmount: true,
          status: true,
          requiredSignatures: true,
          createdAt: true,
          contract: { select: { code: true, name: true } },
          _count: { select: { approvals: true } },
        },
        take: 100,
        orderBy: { createdAt: 'asc' },
      }),
      this.invoiceDiscrepancyStats(tenantId, from, to, contractId),
      this.sumOverpaymentPrevention(tenantId, from, to, contractId),
      this.monthlySpendSeries(tenantId, from, to, contractId),
      this.topVendorsWithLeadTime(tenantId, from, to, contractId),
      this.multiproviderAdjudicationSavings(tenantId, from, to, contractId),
      this.requisitionPipelineCounts(
        tenantId,
        contractId,
        excludeClosedRequisitions,
      ),
      this.partialRequisitionLineCoverage(tenantId, contractId),
      this.requisitionsSnapshotForReport(tenantId, from, to, contractId),
    ]);

    const criticalOrders = criticalOrdersRaw
      .filter((o) => o._count.approvals < o.requiredSignatures)
      .slice(0, 50)
      .map((o) => ({
        id: o.id,
        correlative: o.correlative,
        totalAmount: Number(o.totalAmount),
        status: o.status,
        requiredSignatures: o.requiredSignatures,
        approvalsCount: o._count.approvals,
        hoursWaiting: Math.floor(
          (Date.now() - o.createdAt.getTime()) / (60 * 60 * 1000),
        ),
        contract: o.contract,
      }));

    const gen = Number(spendGeneral._sum.totalAmount ?? 0);
    const eq = Number(spendEquipment._sum.totalAmount ?? 0);
    const wo = Number(spendWorkOrder._sum.totalAmount ?? 0);

    return {
      filters: {
        from: from.toISOString(),
        to: to.toISOString(),
        contractId: contractId ?? null,
        excludeClosedRequisitions,
      },
      kpis: {
        totalApprovedSpend: Number(totalApprovedSpend._sum.totalAmount ?? 0),
        pendingSignaturePurchaseOrders: pendingSignatureCount,
        invoiceDiscrepancyRate: invoiceStats.rate,
        invoiceDiscrepancyCount: invoiceStats.discrepancyCount,
        invoiceTotalForRate: invoiceStats.totalForRate,
        multiproviderAdjudicationSavings: multiproviderSavings,
      },
      imputationSpend: {
        general: gen,
        equipment: eq,
        workOrder: wo,
      },
      monthlySpend: monthlyRows,
      topVendors: vendorRows,
      criticalOrders,
      overpaymentPrevention: Number(overpaymentRow[0]?.sum ?? 0),
      requisitionPipeline,
      partialRequisitionPurchaseProgress,
      requisitionPurchaseRows,
    };
  }

  /** Σ (max P.U. cotizado por ítem − P.U. adjudicado) × cantidad, SRC tocados en el período. */
  private async multiproviderAdjudicationSavings(
    tenantId: string,
    from: Date,
    to: Date,
    contractId?: string,
  ): Promise<number> {
    const sumRow = async () => {
      if (contractId) {
        return this.prisma.$queryRaw<{ s: unknown }[]>`
          SELECT COALESCE(SUM(
            GREATEST(0,
              COALESCE((
                SELECT MAX(qi2.unit_price::numeric)
                FROM quotation_items qi2
                INNER JOIN purchase_quotations pq2 ON pq2.id = qi2.quotation_id
                WHERE qi2.requisition_item_id = ri.id
                  AND pq2.status::text <> 'REJECTED'
              ), aw.unit_price::numeric) - aw.unit_price::numeric
            ) * ri.quantity::double precision
          ), 0)::numeric AS s
          FROM requisition_items ri
          INNER JOIN quotation_items aw ON aw.id = ri.awarded_quotation_item_id
          INNER JOIN purchase_requisitions pr ON pr.id = ri.requisition_id
          WHERE pr.tenant_id = ${tenantId}::uuid
            AND pr.contract_id = ${contractId}::uuid
            AND pr.updated_at >= ${from}
            AND pr.updated_at <= ${to}
            AND ri.awarded_quotation_item_id IS NOT NULL
        `;
      }
      return this.prisma.$queryRaw<{ s: unknown }[]>`
        SELECT COALESCE(SUM(
          GREATEST(0,
            COALESCE((
              SELECT MAX(qi2.unit_price::numeric)
              FROM quotation_items qi2
              INNER JOIN purchase_quotations pq2 ON pq2.id = qi2.quotation_id
              WHERE qi2.requisition_item_id = ri.id
                AND pq2.status::text <> 'REJECTED'
            ), aw.unit_price::numeric) - aw.unit_price::numeric
          ) * ri.quantity::double precision
        ), 0)::numeric AS s
        FROM requisition_items ri
        INNER JOIN quotation_items aw ON aw.id = ri.awarded_quotation_item_id
        INNER JOIN purchase_requisitions pr ON pr.id = ri.requisition_id
        WHERE pr.tenant_id = ${tenantId}::uuid
          AND pr.updated_at >= ${from}
          AND pr.updated_at <= ${to}
          AND ri.awarded_quotation_item_id IS NOT NULL
      `;
    };
    const rows = await sumRow();
    return Number(rows[0]?.s ?? 0);
  }

  private async requisitionPipelineCounts(
    tenantId: string,
    contractId?: string,
    excludeClosed = true,
  ): Promise<Record<string, number>> {
    const rows = await this.prisma.purchaseRequisition.groupBy({
      by: ['status'],
      where: {
        tenantId,
        ...(contractId ? { contractId } : {}),
        ...(excludeClosed ? { status: { not: 'CLOSED' } } : {}),
      },
      _count: { _all: true },
    });
    return Object.fromEntries(
      rows.map((r) => [r.status, r._count._all]),
    ) as Record<string, number>;
  }

  private async partialRequisitionLineCoverage(
    tenantId: string,
    contractId?: string,
  ): Promise<{
    partialRequisitionCount: number;
    lineItemsTotal: number;
    lineItemsWithActivePo: number;
  }> {
    const partialReqs = await this.prisma.purchaseRequisition.findMany({
      where: {
        tenantId,
        status: 'PARTIALLY_PURCHASED',
        ...(contractId ? { contractId } : {}),
      },
      select: {
        id: true,
        items: {
          select: {
            awardedQuotationItemId: true,
          },
        },
      },
    });
    let lineItemsTotal = 0;
    let lineItemsWithActivePo = 0;
    const reqIds = partialReqs.map((r) => r.id);
    const awardPairs = partialReqs.flatMap((pr) =>
      pr.items
        .filter((i) => i.awardedQuotationItemId)
        .map((i) => ({
          reqId: pr.id,
          awardId: i.awardedQuotationItemId as string,
        })),
    );
    const awardIds = [...new Set(awardPairs.map((p) => p.awardId))];
    if (awardIds.length && reqIds.length) {
      const hits = await this.prisma.purchaseOrderItem.findMany({
        where: {
          sourceQuotationItemId: { in: awardIds },
          purchaseOrder: {
            tenantId,
            status: { notIn: ['CANCELLED', 'REJECTED'] },
            OR: [
              { requisitionId: { in: reqIds } },
              { quotation: { requisitionId: { in: reqIds } } },
            ],
          },
        },
        select: {
          sourceQuotationItemId: true,
          purchaseOrder: {
            select: {
              requisitionId: true,
              quotation: { select: { requisitionId: true } },
            },
          },
        },
      });
      const covered = new Set<string>();
      for (const h of hits) {
        const aid = h.sourceQuotationItemId;
        if (!aid) continue;
        const rid =
          h.purchaseOrder.requisitionId ??
          h.purchaseOrder.quotation?.requisitionId;
        if (rid) covered.add(`${rid}|${aid}`);
      }
      for (const pr of partialReqs) {
        for (const it of pr.items) {
          lineItemsTotal++;
          if (
            it.awardedQuotationItemId &&
            covered.has(`${pr.id}|${it.awardedQuotationItemId}`)
          ) {
            lineItemsWithActivePo++;
          }
        }
      }
    } else {
      for (const pr of partialReqs) {
        lineItemsTotal += pr.items.length;
      }
    }
    return {
      partialRequisitionCount: partialReqs.length,
      lineItemsTotal,
      lineItemsWithActivePo,
    };
  }

  private async requisitionsSnapshotForReport(
    tenantId: string,
    from: Date,
    to: Date,
    contractId?: string,
  ): Promise<
    Array<{
      correlative: string;
      status: string;
      ocLines: string[];
    }>
  > {
    const rows = await this.prisma.purchaseRequisition.findMany({
      where: {
        tenantId,
        updatedAt: { gte: from, lte: to },
        ...(contractId ? { contractId } : {}),
        status: { notIn: ['DRAFT', 'CANCELLED'] },
      },
      orderBy: { updatedAt: 'desc' },
      take: 35,
      select: {
        correlative: true,
        status: true,
        purchaseOrders: {
          where: { status: { notIn: ['CANCELLED', 'REJECTED'] } },
          select: {
            correlative: true,
            status: true,
            quotation: {
              select: {
                vendor: { select: { name: true, code: true } },
              },
            },
          },
        },
      },
    });
    return rows.map((r) => ({
      correlative: r.correlative,
      status: r.status,
      ocLines: r.purchaseOrders.map((po) => {
        const vn =
          po.quotation?.vendor?.name ??
          po.quotation?.vendor?.code ??
          'Proveedor';
        return `${po.correlative} · ${vn} · ${po.status}`;
      }),
    }));
  }

  private async invoiceDiscrepancyStats(
    tenantId: string,
    from: Date,
    to: Date,
    contractId?: string,
  ) {
    const base: Prisma.PurchaseInvoiceWhereInput = {
      tenantId,
      createdAt: { gte: from, lte: to },
      ...(contractId ? { purchaseOrder: { contractId } } : {}),
    };
    const [discrepancyCount, matchedOrPaidOrDisc] = await Promise.all([
      this.prisma.purchaseInvoice.count({
        where: { ...base, status: 'DISCREPANCY' },
      }),
      this.prisma.purchaseInvoice.count({
        where: {
          ...base,
          status: { in: ['MATCHED', 'DISCREPANCY', 'PAID'] },
        },
      }),
    ]);
    const rate = matchedOrPaidOrDisc
      ? discrepancyCount / matchedOrPaidOrDisc
      : 0;
    return {
      discrepancyCount,
      totalForRate: matchedOrPaidOrDisc,
      rate,
    };
  }

  /** Suma prevención de sobrepagos (monto corregido al pasar de discrepancia a match). */
  private async sumOverpaymentPrevention(
    tenantId: string,
    from: Date,
    to: Date,
    contractId?: string,
  ) {
    if (contractId) {
      return this.prisma.$queryRaw<{ sum: Prisma.Decimal | null }[]>`
        SELECT COALESCE(SUM(
          COALESCE(
            (al.details->'newValue'->>'overpaymentPreventionAmount')::numeric,
            (al.details->'newValue'->>'gapResolvedAmount')::numeric,
            0
          )
        ), 0) AS sum
        FROM activity_logs al
        INNER JOIN purchase_invoices pi ON pi.id::text = al.entity_id
        INNER JOIN purchase_orders po ON po.id = pi.purchase_order_id
        WHERE al.tenant_id = ${tenantId}::uuid
          AND al.entity_type = 'PURCHASE_INVOICE'
          AND al.details->'newValue'->>'event' = 'invoice_three_way_match_resolved'
          AND al.created_at >= ${from}
          AND al.created_at <= ${to}
          AND po.contract_id = ${contractId}::uuid
      `;
    }
    return this.prisma.$queryRaw<{ sum: Prisma.Decimal | null }[]>`
      SELECT COALESCE(SUM(
        COALESCE(
          (details->'newValue'->>'overpaymentPreventionAmount')::numeric,
          (details->'newValue'->>'gapResolvedAmount')::numeric,
          0
        )
      ), 0) AS sum
      FROM activity_logs
      WHERE tenant_id = ${tenantId}::uuid
        AND entity_type = 'PURCHASE_INVOICE'
        AND details->'newValue'->>'event' = 'invoice_three_way_match_resolved'
        AND created_at >= ${from}
        AND created_at <= ${to}
    `;
  }

  private async monthlySpendSeries(
    tenantId: string,
    from: Date,
    to: Date,
    contractId?: string,
  ) {
    const rows = contractId
      ? await this.prisma.$queryRaw<{ month: Date; total: Prisma.Decimal }[]>`
        SELECT date_trunc('month', po.created_at) AS month,
               SUM(po.total_amount)::decimal AS total
        FROM purchase_orders po
        WHERE po.tenant_id = ${tenantId}::uuid
          AND po.status IN ('APPROVED','SENT','ORDERED','SENT_TO_SUPPLIER','PARTIALLY_RECEIVED','RECEIVED','CLOSED')
          AND po.created_at >= ${from}
          AND po.created_at <= ${to}
          AND po.contract_id = ${contractId}::uuid
        GROUP BY 1
        ORDER BY 1 ASC
      `
      : await this.prisma.$queryRaw<{ month: Date; total: Prisma.Decimal }[]>`
        SELECT date_trunc('month', po.created_at) AS month,
               SUM(po.total_amount)::decimal AS total
        FROM purchase_orders po
        WHERE po.tenant_id = ${tenantId}::uuid
          AND po.status IN ('APPROVED','SENT','ORDERED','SENT_TO_SUPPLIER','PARTIALLY_RECEIVED','RECEIVED','CLOSED')
          AND po.created_at >= ${from}
          AND po.created_at <= ${to}
        GROUP BY 1
        ORDER BY 1 ASC
      `;

    return rows.map((r) => ({
      month: r.month.toISOString().slice(0, 10),
      total: Number(r.total),
    }));
  }

  private async topVendorsWithLeadTime(
    tenantId: string,
    from: Date,
    to: Date,
    contractId?: string,
  ) {
    const rows = contractId
      ? await this.prisma.$queryRaw<
          {
            vendor_id: string;
            vendor_name: string;
            vendor_code: string;
            volume: Prisma.Decimal;
            avg_lead_days: number | null;
          }[]
        >`
        WITH first_rx AS (
          SELECT wr.purchase_order_id,
                 MIN(wr.received_at) AS first_at
          FROM warehouse_receipts wr
          WHERE wr.status IN ('PARTIAL', 'COMPLETED')
            AND wr.received_at IS NOT NULL
          GROUP BY wr.purchase_order_id
        ),
        po_vendor AS (
          SELECT po.id AS po_id,
                 po.created_at AS po_created,
                 po.total_amount,
                 q.vendor_id AS vendor_id,
                 v.name AS vendor_name,
                 v.code AS vendor_code
          FROM purchase_orders po
          INNER JOIN purchase_quotations q ON q.id = po.quotation_id
          INNER JOIN vendors v ON v.id = q.vendor_id
          WHERE po.tenant_id = ${tenantId}::uuid
            AND po.created_at >= ${from}
            AND po.created_at <= ${to}
            AND po.contract_id = ${contractId}::uuid
        )
        SELECT pv.vendor_id,
               MAX(pv.vendor_name) AS vendor_name,
               MAX(pv.vendor_code) AS vendor_code,
               SUM(pv.total_amount)::decimal AS volume,
               AVG(
                 EXTRACT(EPOCH FROM (fr.first_at - pv.po_created)) / 86400.0
               )::float AS avg_lead_days
        FROM po_vendor pv
        LEFT JOIN first_rx fr ON fr.purchase_order_id = pv.po_id
        GROUP BY pv.vendor_id
        ORDER BY SUM(pv.total_amount) DESC
        LIMIT 5
      `
      : await this.prisma.$queryRaw<
          {
            vendor_id: string;
            vendor_name: string;
            vendor_code: string;
            volume: Prisma.Decimal;
            avg_lead_days: number | null;
          }[]
        >`
        WITH first_rx AS (
          SELECT wr.purchase_order_id,
                 MIN(wr.received_at) AS first_at
          FROM warehouse_receipts wr
          WHERE wr.status IN ('PARTIAL', 'COMPLETED')
            AND wr.received_at IS NOT NULL
          GROUP BY wr.purchase_order_id
        ),
        po_vendor AS (
          SELECT po.id AS po_id,
                 po.created_at AS po_created,
                 po.total_amount,
                 q.vendor_id AS vendor_id,
                 v.name AS vendor_name,
                 v.code AS vendor_code
          FROM purchase_orders po
          INNER JOIN purchase_quotations q ON q.id = po.quotation_id
          INNER JOIN vendors v ON v.id = q.vendor_id
          WHERE po.tenant_id = ${tenantId}::uuid
            AND po.created_at >= ${from}
            AND po.created_at <= ${to}
        )
        SELECT pv.vendor_id,
               MAX(pv.vendor_name) AS vendor_name,
               MAX(pv.vendor_code) AS vendor_code,
               SUM(pv.total_amount)::decimal AS volume,
               AVG(
                 EXTRACT(EPOCH FROM (fr.first_at - pv.po_created)) / 86400.0
               )::float AS avg_lead_days
        FROM po_vendor pv
        LEFT JOIN first_rx fr ON fr.purchase_order_id = pv.po_id
        GROUP BY pv.vendor_id
        ORDER BY SUM(pv.total_amount) DESC
        LIMIT 5
      `;

    return rows.map((r) => ({
      vendorId: r.vendor_id,
      vendorName: r.vendor_name,
      vendorCode: r.vendor_code,
      purchaseVolume: Number(r.volume),
      avgLeadTimeDays:
        r.avg_lead_days != null && !Number.isNaN(r.avg_lead_days)
          ? Math.round(r.avg_lead_days * 10) / 10
          : null,
    }));
  }

  /**
   * PDF ejecutivo de compras (KPIs, imputación, proveedores, lead times, notas de control).
   */
  async buildExecutiveReportPdf(
    tenantId: string,
    query: { contractId?: string; from?: string; to?: string },
  ): Promise<{ buffer: Buffer; filename: string }> {
    const data = (await this.getDashboard(
      tenantId,
      query,
    )) as PurchasesAnalyticsDashboardPdfData;

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true, logoUrl: true },
    });

    let logoBuffer: Buffer | null = null;
    const logoUrl = tenant?.logoUrl?.trim();
    if (
      logoUrl &&
      (logoUrl.startsWith('http://') || logoUrl.startsWith('https://'))
    ) {
      try {
        const res = await fetch(logoUrl);
        if (res.ok) {
          const ab = await res.arrayBuffer();
          logoBuffer = Buffer.from(ab);
        }
      } catch {
        logoBuffer = null;
      }
    }

    const toDate = query.to ? new Date(query.to) : new Date();
    const fromDate = query.from
      ? new Date(query.from)
      : new Date(toDate.getTime() - 365 * 24 * 60 * 60 * 1000);

    let contractLabel = 'Todos los contratos';
    let contractFile = 'TODOS';
    const cid = query.contractId?.trim();
    if (cid) {
      const c = await this.prisma.contract.findFirst({
        where: { id: cid, tenantId },
        select: { code: true, name: true },
      });
      if (c) {
        contractLabel = `${c.code} — ${c.name}`;
        contractFile = (c.code || 'CONTRATO').replace(/[^\w.-]+/g, '_');
      }
    }

    const mm = String(toDate.getUTCMonth() + 1).padStart(2, '0');
    const yyyy = toDate.getUTCFullYear();

    const buffer = await generatePurchasesAnalyticsReportPdfBuffer(
      tenant?.name ?? 'Organización',
      logoBuffer,
      contractLabel,
      fromDate,
      toDate,
      data,
    );

    const filename = `Reporte_Compras_${contractFile}_${yyyy}-${mm}.pdf`;
    return { buffer, filename };
  }
}
