import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { fetchTenantPdfLogoDataUri } from '../../common/pdf/fetch-tenant-pdf-logo';
import { StorageService } from '../../common/storage/storage.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  generateValuationFullReportPdfBuffer,
  generateValuationFullReportXlsxBuffer,
  ValuationFullReportData,
} from './inventory-valuation-full-report.generator';
import {
  generateValuationSummaryPdfBuffer,
  generateValuationSummaryXlsxBuffer,
} from './inventory-valuation-summary-report.generator';
import {
  defaultFullReportOptions,
  ValuationFullReportOptions,
} from './full-report-options.types';
import { applyFullReportOptions } from './apply-full-report-options.util';

@Injectable()
export class InventoryAnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  private sqlWarehouseIdsFilter(
    warehouseIds: string[] | null,
    warehouseAlias = 'w',
  ): Prisma.Sql {
    if (!warehouseIds?.length) return Prisma.empty;
    return Prisma.sql`AND ${Prisma.raw(warehouseAlias)}.id IN (${Prisma.join(
      warehouseIds.map((id) => Prisma.sql`${id}::uuid`),
    )})`;
  }

  private gradingForLeadDays(days: number | null): 'A' | 'B' | 'C' {
    if (days == null) return 'C';
    if (days <= 3) return 'A';
    if (days <= 7) return 'B';
    return 'C';
  }

  private monthRange(month?: string): { from: Date; to: Date } {
    if (month?.trim()) {
      const normalized = `${month.trim()}-01T00:00:00.000Z`;
      const from = new Date(normalized);
      if (!Number.isNaN(from.getTime())) {
        const to = new Date(from);
        to.setUTCMonth(to.getUTCMonth() + 1);
        return { from, to };
      }
    }
    const now = new Date();
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const to = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
    );
    return { from, to };
  }

  /**
   * Valorización global: Σ(cantidad × CPP) en ItemStock, agrupado por familia (nivel 1).
   */
  async getValuationByFamily(user: { tenantId: string }) {
    const tenantId = user.tenantId;
    const rows = await this.prisma.$queryRaw<
      { family_id: string; family_name: string; total_value: unknown }[]
    >(Prisma.sql`
      WITH item_family AS (
        SELECT
          ii.id AS item_id,
          COALESCE(parent.id, leaf.id) AS family_id,
          COALESCE(parent.name, leaf.name) AS family_name
        FROM inventory_items ii
        INNER JOIN item_categories leaf ON leaf.id = ii.category_id
        LEFT JOIN item_categories parent ON parent.id = leaf.parent_category_id
        WHERE ii.tenant_id = ${tenantId}::uuid
      )
      SELECT
        f.family_id,
        f.family_name,
        COALESCE(SUM(s.quantity * COALESCE(s.unit_cost, 0)), 0)::decimal AS total_value
      FROM item_stocks s
      INNER JOIN item_family f ON f.item_id = s.item_id
      GROUP BY f.family_id, f.family_name
      ORDER BY f.family_name ASC
    `);

    const byFamily = rows.map((r) => ({
      familyId: r.family_id,
      familyName: r.family_name,
      totalValue: Number(r.total_value),
    }));

    const grandTotal = byFamily.reduce((s, r) => s + r.totalValue, 0);

    return {
      grandTotal,
      byFamily,
    };
  }

  /**
   * Datos para reporte maestro (PDF/XLSX): detalle por artículo, resumen y valor por bodega.
   */
  async buildFullReportData(
    user: { tenantId: string },
    reportOptions: ValuationFullReportOptions = defaultFullReportOptions(),
  ): Promise<ValuationFullReportData> {
    const tenantId = user.tenantId;
    const generatedAt = new Date();
    const warehouseIds = reportOptions.filters.warehouseIds;
    const whFilter = this.sqlWarehouseIdsFilter(warehouseIds);
    const criticalLimit = reportOptions.limits.criticalMaxRows;
    const deadLimit = reportOptions.limits.deadStockMaxRows;
    const purchaseTake = reportOptions.limits.purchaseMaxRows;

    const lineRows = await this.prisma.$queryRaw<
      {
        family_name: string;
        subcategory_name: string;
        inventory_code: string | null;
        part_number: string | null;
        item_name: string;
        item_description: string | null;
        total_qty: unknown;
        total_val: unknown;
      }[]
    >(Prisma.sql`
      SELECT
        COALESCE(par.name, leaf.name) AS family_name,
        CASE
          WHEN leaf.parent_category_id IS NOT NULL THEN leaf.name
          ELSE ''
        END AS subcategory_name,
        ii.inventory_code,
        ii.part_number,
        ii.name AS item_name,
        ii.description AS item_description,
        COALESCE(SUM(s.quantity), 0)::double precision AS total_qty,
        COALESCE(SUM(s.quantity * COALESCE(s.unit_cost, 0)), 0)::decimal AS total_val
      FROM inventory_items ii
      INNER JOIN item_categories leaf ON leaf.id = ii.category_id
      LEFT JOIN item_categories par ON par.id = leaf.parent_category_id
      LEFT JOIN item_stocks s ON s.item_id = ii.id
      LEFT JOIN warehouses w ON w.id = s.warehouse_id AND w.tenant_id = ii.tenant_id
      WHERE ii.tenant_id = ${tenantId}::uuid
      ${whFilter}
      GROUP BY
        ii.id,
        par.name,
        leaf.name,
        leaf.parent_category_id,
        ii.inventory_code,
        ii.part_number,
        ii.name,
        ii.description
      ORDER BY family_name ASC, subcategory_name ASC, ii.inventory_code ASC NULLS LAST, ii.part_number ASC NULLS LAST
    `);

    const lines = lineRows.map((r) => {
      const totalQty = Number(r.total_qty);
      const totalVal = Number(r.total_val);
      const cpp = totalQty > 1e-9 ? totalVal / totalQty : 0;
      return {
        familyName: r.family_name ?? '—',
        subcategoryName: r.subcategory_name ?? '',
        inventoryCode: r.inventory_code?.trim() || '',
        partNumber: r.part_number?.trim() || '',
        itemName: r.item_name?.trim() || '—',
        itemDescription: r.item_description?.trim() || '—',
        totalQty,
        cpp,
        lineValue: totalVal,
      };
    });

    const belowRows = await this.prisma.$queryRaw<{ c: unknown }[]>(Prisma.sql`
      SELECT COUNT(DISTINCT s.item_id)::int AS c
      FROM item_stocks s
      INNER JOIN warehouses w ON w.id = s.warehouse_id AND w.tenant_id = ${tenantId}::uuid
      WHERE s.quantity <= s.min_stock
      ${whFilter}
    `);
    const itemsBelowMinCount = Number(belowRows[0]?.c ?? 0);

    const whRows = await this.prisma.$queryRaw<
      { id: string; code: string; name: string; total_value: unknown }[]
    >(Prisma.sql`
      SELECT
        w.id,
        w.code,
        w.name,
        COALESCE(SUM(s.quantity * COALESCE(s.unit_cost, 0)), 0)::decimal AS total_value
      FROM warehouses w
      LEFT JOIN item_stocks s ON s.warehouse_id = w.id
      WHERE w.tenant_id = ${tenantId}::uuid
      ${whFilter}
      GROUP BY w.id, w.code, w.name
      ORDER BY w.code ASC
    `);

    const byWarehouse = whRows.map((r) => ({
      warehouseId: r.id,
      warehouseCode: r.code,
      warehouseName: r.name,
      totalValue: Number(r.total_value),
    }));

    const familyRows = await this.prisma.$queryRaw<
      { family_name: string; total_value: unknown }[]
    >(Prisma.sql`
      WITH item_family AS (
        SELECT
          ii.id AS item_id,
          COALESCE(parent.name, leaf.name) AS family_name
        FROM inventory_items ii
        INNER JOIN item_categories leaf ON leaf.id = ii.category_id
        LEFT JOIN item_categories parent ON parent.id = leaf.parent_category_id
        WHERE ii.tenant_id = ${tenantId}::uuid
      )
      SELECT
        f.family_name,
        COALESCE(SUM(s.quantity * COALESCE(s.unit_cost, 0)), 0)::decimal AS total_value
      FROM item_stocks s
      INNER JOIN item_family f ON f.item_id = s.item_id
      GROUP BY f.family_name
      ORDER BY total_value DESC
    `);

    const byFamily = familyRows.map((r) => ({
      familyName: r.family_name,
      totalValue: Number(r.total_value),
    }));

    const criticalRows = await this.prisma.$queryRaw<
      {
        item_id: string;
        part_number: string;
        item_name: string;
        item_description: string | null;
        family_name: string;
        current_stock: unknown;
        min_stock: unknown;
        risk_gap: unknown;
      }[]
    >(Prisma.sql`
      WITH stock_by_item AS (
        SELECT
          ii.id AS item_id,
          ii.part_number,
          ii.name AS item_name,
          ii.description AS item_description,
          COALESCE(parent.name, leaf.name) AS family_name,
          COALESCE(SUM(s.quantity), 0)::double precision AS current_stock,
          COALESCE(MAX(s.min_stock), 0)::double precision AS min_stock
        FROM inventory_items ii
        INNER JOIN item_categories leaf ON leaf.id = ii.category_id
        LEFT JOIN item_categories parent ON parent.id = leaf.parent_category_id
        LEFT JOIN item_stocks s ON s.item_id = ii.id
        LEFT JOIN warehouses w ON w.id = s.warehouse_id AND w.tenant_id = ii.tenant_id
        WHERE ii.tenant_id = ${tenantId}::uuid
        ${whFilter}
        GROUP BY ii.id, ii.part_number, ii.name, ii.description, parent.name, leaf.name
      )
      SELECT
        item_id,
        part_number,
        item_name,
        item_description,
        family_name,
        current_stock,
        min_stock,
        (min_stock - current_stock)::double precision AS risk_gap
      FROM stock_by_item
      WHERE min_stock > 0 AND current_stock < min_stock
      ORDER BY (min_stock - current_stock) DESC, current_stock ASC
      LIMIT ${criticalLimit}
    `);

    const criticalItems = criticalRows.map((r) => ({
      itemId: r.item_id,
      partNumber: r.part_number?.trim() || '',
      itemName: r.item_name?.trim() || '—',
      itemDescription: r.item_description?.trim() || '—',
      familyName: r.family_name ?? '—',
      currentStock: Number(r.current_stock),
      minStock: Number(r.min_stock),
      riskGap: Number(r.risk_gap),
    }));

    const deadStockRows = await this.prisma.$queryRaw<
      {
        item_id: string;
        part_number: string;
        item_name: string;
        item_description: string | null;
        family_name: string;
        total_qty: unknown;
        total_val: unknown;
      }[]
    >(Prisma.sql`
      WITH last_move AS (
        SELECT
          it.item_id,
          MAX(it.date) AS last_move_at
        FROM inventory_transactions it
        INNER JOIN warehouses w ON w.id = it.warehouse_id
        WHERE w.tenant_id = ${tenantId}::uuid
        GROUP BY it.item_id
      ),
      stock_by_item AS (
        SELECT
          ii.id AS item_id,
          ii.part_number,
          ii.name AS item_name,
          ii.description AS item_description,
          COALESCE(parent.name, leaf.name) AS family_name,
          COALESCE(SUM(s.quantity), 0)::double precision AS total_qty,
          COALESCE(SUM(s.quantity * COALESCE(s.unit_cost, 0)), 0)::decimal AS total_val,
          lm.last_move_at
        FROM inventory_items ii
        INNER JOIN item_categories leaf ON leaf.id = ii.category_id
        LEFT JOIN item_categories parent ON parent.id = leaf.parent_category_id
        LEFT JOIN item_stocks s ON s.item_id = ii.id
        LEFT JOIN warehouses w ON w.id = s.warehouse_id AND w.tenant_id = ii.tenant_id
        LEFT JOIN last_move lm ON lm.item_id = ii.id
        WHERE ii.tenant_id = ${tenantId}::uuid
        ${whFilter}
        GROUP BY ii.id, ii.part_number, ii.name, ii.description, parent.name, leaf.name, lm.last_move_at
      )
      SELECT
        item_id,
        part_number,
        item_name,
        item_description,
        family_name,
        total_qty,
        total_val
      FROM stock_by_item
      WHERE total_qty > 0
        AND (
          last_move_at IS NULL OR
          last_move_at < (NOW() - INTERVAL '6 months')
        )
      ORDER BY total_val DESC
      LIMIT ${deadLimit}
    `);

    const deadStockItems = deadStockRows.map((r) => ({
      itemId: r.item_id,
      partNumber: r.part_number?.trim() || '',
      itemName: r.item_name?.trim() || '—',
      itemDescription: r.item_description?.trim() || '—',
      familyName: r.family_name ?? '—',
      quantity: Number(r.total_qty),
      totalValue: Number(r.total_val),
    }));

    const immobilizedCapital = deadStockItems.reduce(
      (sum, row) => sum + row.totalValue,
      0,
    );

    const inventoryGrandTotal = byWarehouse.reduce(
      (s, w) => s + w.totalValue,
      0,
    );

    const purchaseRequisitionExportRows =
      await this.prisma.purchaseRequisition.findMany({
        where: {
          tenantId,
          status: { notIn: ['DRAFT', 'CANCELLED'] },
        },
        orderBy: { updatedAt: 'desc' },
        take: purchaseTake,
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

    return {
      generatedAt,
      lines,
      itemsBelowMinCount,
      byWarehouse,
      byFamily,
      inventoryGrandTotal,
      criticalItems,
      deadStockItems,
      immobilizedCapital,
      purchaseRequisitionExportRows: purchaseRequisitionExportRows.map((r) => ({
        correlative: r.correlative,
        status: r.status,
        ocVendorDetail: r.purchaseOrders
          .map((po) => {
            const vn =
              po.quotation?.vendor?.name ?? po.quotation?.vendor?.code ?? '—';
            return `${po.correlative} — ${vn} — ${po.status}`;
          })
          .join(' | '),
      })),
    };
  }

  async getVendorsPerformance(
    tenantId: string,
    query: { from?: string; to?: string },
  ) {
    const to = query.to ? new Date(query.to) : new Date();
    const from = query.from
      ? new Date(query.from)
      : new Date(to.getTime() - 365 * 24 * 60 * 60 * 1000);
    const rows = await this.prisma.$queryRaw<
      {
        vendor_id: string;
        vendor_code: string;
        vendor_name: string;
        receipts_count: unknown;
        avg_lead_days: unknown;
        late_receipts_count: unknown;
      }[]
    >(Prisma.sql`
      WITH receipt_base AS (
        SELECT DISTINCT ON (wr.id)
          wr.id AS receipt_id,
          COALESCE(q.vendor_id, fb.vendor_id) AS vendor_id,
          po.sent_at,
          wr.received_at,
          COALESCE(q.delivery_days, fb.delivery_days) AS delivery_days
        FROM warehouse_receipts wr
        INNER JOIN purchase_orders po ON po.id = wr.purchase_order_id
        LEFT JOIN purchase_quotations q ON q.id = po.quotation_id
        LEFT JOIN LATERAL (
          SELECT pq.vendor_id, pq.delivery_days
          FROM purchase_order_items poi
          INNER JOIN quotation_items qi ON qi.id = poi.source_quotation_item_id
          INNER JOIN purchase_quotations pq ON pq.id = qi.quotation_id
          WHERE poi.purchase_order_id = po.id
          ORDER BY poi.id ASC
          LIMIT 1
        ) fb ON TRUE
        WHERE po.tenant_id = ${tenantId}::uuid
          AND po.sent_at IS NOT NULL
          AND wr.received_at IS NOT NULL
          AND wr.received_at >= ${from}
          AND wr.received_at <= ${to}
          AND COALESCE(q.vendor_id, fb.vendor_id) IS NOT NULL
      )
      SELECT
        v.id AS vendor_id,
        v.code AS vendor_code,
        v.name AS vendor_name,
        COUNT(rb.receipt_id)::int AS receipts_count,
        AVG(EXTRACT(EPOCH FROM (rb.received_at - rb.sent_at)) / 86400.0)::float AS avg_lead_days,
        SUM(
          CASE
            WHEN rb.delivery_days IS NOT NULL
                 AND rb.received_at > (rb.sent_at + (rb.delivery_days || ' days')::interval)
            THEN 1 ELSE 0
          END
        )::int AS late_receipts_count
      FROM receipt_base rb
      INNER JOIN vendors v ON v.id = rb.vendor_id
      GROUP BY v.id, v.code, v.name
      ORDER BY avg_lead_days ASC NULLS LAST, v.name ASC
    `);

    const vendors = rows.map((r) => {
      const avgLeadTimeDays = Number(r.avg_lead_days ?? 0);
      const receipts = Number(r.receipts_count ?? 0);
      const lateReceipts = Number(r.late_receipts_count ?? 0);
      const onTimeRate =
        receipts > 0 ? (receipts - lateReceipts) / receipts : 0;
      return {
        vendorId: r.vendor_id,
        vendorCode: r.vendor_code,
        vendorName: r.vendor_name,
        receiptsCount: receipts,
        avgLeadTimeDays: Math.round(avgLeadTimeDays * 10) / 10,
        lateReceiptsCount: lateReceipts,
        onTimeRate,
        grade: this.gradingForLeadDays(avgLeadTimeDays),
      };
    });
    return { from: from.toISOString(), to: to.toISOString(), vendors };
  }

  async getSavingsVariation(tenantId: string, month?: string) {
    const { from, to } = this.monthRange(month);
    const rows = await this.prisma.$queryRaw<
      {
        item_id: string;
        family_name: string;
        current_unit_cost: unknown;
        current_qty: unknown;
        historical_avg_unit_cost: unknown;
      }[]
    >(Prisma.sql`
      WITH item_family AS (
        SELECT
          ii.id AS item_id,
          COALESCE(parent.name, leaf.name) AS family_name
        FROM inventory_items ii
        INNER JOIN item_categories leaf ON leaf.id = ii.category_id
        LEFT JOIN item_categories parent ON parent.id = leaf.parent_category_id
        WHERE ii.tenant_id = ${tenantId}::uuid
      ),
      current_month AS (
        SELECT
          poi.inventory_item_id AS item_id,
          po.created_at AS purchased_at,
          poi.unit_cost::numeric AS unit_cost,
          poi.quantity::double precision AS qty,
          ROW_NUMBER() OVER (
            PARTITION BY poi.inventory_item_id
            ORDER BY po.created_at DESC, po.id DESC
          ) AS rn
        FROM purchase_order_items poi
        INNER JOIN purchase_orders po ON po.id = poi.purchase_order_id
        WHERE po.tenant_id = ${tenantId}::uuid
          AND poi.inventory_item_id IS NOT NULL
          AND po.created_at >= ${from}
          AND po.created_at < ${to}
          AND po.status IN ('APPROVED','SENT','ORDERED','SENT_TO_SUPPLIER','PARTIALLY_RECEIVED','RECEIVED','CLOSED')
      ),
      historical AS (
        SELECT
          poi.inventory_item_id AS item_id,
          AVG(poi.unit_cost::numeric)::numeric AS avg_unit_cost
        FROM purchase_order_items poi
        INNER JOIN purchase_orders po ON po.id = poi.purchase_order_id
        WHERE po.tenant_id = ${tenantId}::uuid
          AND poi.inventory_item_id IS NOT NULL
          AND po.created_at < ${from}
          AND po.status IN ('APPROVED','SENT','ORDERED','SENT_TO_SUPPLIER','PARTIALLY_RECEIVED','RECEIVED','CLOSED')
        GROUP BY poi.inventory_item_id
      )
      SELECT
        cm.item_id,
        COALESCE(f.family_name, 'Sin familia') AS family_name,
        cm.unit_cost AS current_unit_cost,
        cm.qty AS current_qty,
        h.avg_unit_cost AS historical_avg_unit_cost
      FROM current_month cm
      LEFT JOIN historical h ON h.item_id = cm.item_id
      LEFT JOIN item_family f ON f.item_id = cm.item_id
      WHERE cm.rn = 1
        AND h.avg_unit_cost IS NOT NULL
    `);

    const byFamilyMap = new Map<
      string,
      {
        familyName: string;
        monthlyImpact: number;
        comparedItems: number;
        currentTotal: number;
        historicalTotal: number;
      }
    >();

    let monthlyImpact = 0;
    let currentTotal = 0;
    let historicalTotal = 0;

    for (const row of rows) {
      const currentCost = Number(row.current_unit_cost);
      const historicalAvg = Number(row.historical_avg_unit_cost);
      const qty = Number(row.current_qty);
      const impact = (currentCost - historicalAvg) * qty;
      const fam = row.family_name;
      monthlyImpact += impact;
      currentTotal += currentCost * qty;
      historicalTotal += historicalAvg * qty;
      const prev = byFamilyMap.get(fam) ?? {
        familyName: fam,
        monthlyImpact: 0,
        comparedItems: 0,
        currentTotal: 0,
        historicalTotal: 0,
      };
      prev.monthlyImpact += impact;
      prev.comparedItems += 1;
      prev.currentTotal += currentCost * qty;
      prev.historicalTotal += historicalAvg * qty;
      byFamilyMap.set(fam, prev);
    }

    const byFamily = Array.from(byFamilyMap.values())
      .map((f) => ({
        familyName: f.familyName,
        monthlyImpact: f.monthlyImpact,
        savingsAmount: f.monthlyImpact < 0 ? Math.abs(f.monthlyImpact) : 0,
        overcostAmount: f.monthlyImpact > 0 ? f.monthlyImpact : 0,
        savingsRate:
          f.historicalTotal > 0
            ? ((f.historicalTotal - f.currentTotal) / f.historicalTotal) * 100
            : 0,
        comparedItems: f.comparedItems,
      }))
      .sort((a, b) => a.monthlyImpact - b.monthlyImpact);

    const spareParts = byFamily.find((f) =>
      f.familyName.toLowerCase().includes('repuesto'),
    );

    return {
      month: from.toISOString().slice(0, 7),
      comparedItems: rows.length,
      monthlyImpact,
      savingsAmount: monthlyImpact < 0 ? Math.abs(monthlyImpact) : 0,
      overcostAmount: monthlyImpact > 0 ? monthlyImpact : 0,
      savingsRate:
        historicalTotal > 0
          ? ((historicalTotal - currentTotal) / historicalTotal) * 100
          : 0,
      byFamily,
      spotlightFamily: spareParts ?? byFamily[0] ?? null,
    };
  }

  async globalSearch(tenantId: string, query: string) {
    const rawQuery = query.trim();
    const q = rawQuery.toUpperCase();
    const normalized = q.replace(/[^A-Z0-9]/g, '');
    const compactRaw = rawQuery.replace(/\s+/g, '');
    const stripPrefixes = (v: string) =>
      v
        .replace(
          /^(OC|PO|INV|FAC|REQ|WR|OT|WO|EQ|EQP|REP|WH|BOD)[\s\-_:]*/i,
          '',
        )
        .trim();
    const rawNoPrefix = stripPrefixes(rawQuery);
    const normalizedNoPrefix = stripPrefixes(normalized);
    const searchTerms = Array.from(
      new Set(
        [rawQuery, compactRaw, rawNoPrefix, normalizedNoPrefix].filter(
          (v) => v.length >= 2,
        ),
      ),
    );
    const results: Array<{
      kind: 'REQ' | 'PO' | 'INV' | 'WR' | 'OT' | 'EQUIP' | 'ITEM' | 'WH';
      id: string;
      code: string;
      title: string;
    }> = [];
    const looksLikeOc = /^OC[\s\-_:]*/.test(q) || /^PO[\s\-_:]*/.test(q);
    const looksLikeInv = /^INV[\s\-_:]*/.test(q) || /^FAC[\s\-_:]*/.test(q);
    const shouldSearchPo = looksLikeOc || !looksLikeInv;
    const shouldSearchInv = looksLikeInv || !looksLikeOc;

    if (shouldSearchPo) {
      const poRows = await this.prisma.purchaseOrder.findMany({
        where: {
          tenantId,
          OR: searchTerms.map((term) => ({
            correlative: { contains: term, mode: 'insensitive' as const },
          })),
        },
        select: { id: true, correlative: true, status: true },
        take: 6,
        orderBy: { createdAt: 'desc' },
      });
      for (const po of poRows) {
        results.push({
          kind: 'PO',
          id: po.id,
          code: po.correlative,
          title: `OC ${po.correlative} · ${po.status}`,
        });
      }
    }
    if (shouldSearchInv) {
      const invRows = await this.prisma.purchaseInvoice.findMany({
        where: {
          tenantId,
          OR: searchTerms.map((term) => ({
            invoiceNumber: { contains: term, mode: 'insensitive' as const },
          })),
        },
        select: { id: true, invoiceNumber: true, status: true },
        take: 6,
        orderBy: { createdAt: 'desc' },
      });
      for (const inv of invRows) {
        results.push({
          kind: 'INV',
          id: inv.id,
          code: inv.invoiceNumber,
          title: `Factura ${inv.invoiceNumber} · ${inv.status}`,
        });
      }
    }
    const docRows = await Promise.all([
      this.prisma.purchaseRequisition.findMany({
        where: {
          tenantId,
          OR: searchTerms.map((term) => ({
            correlative: { contains: term, mode: 'insensitive' as const },
          })),
        },
        select: { id: true, correlative: true, status: true },
        take: 4,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.warehouseReceipt.findMany({
        where: {
          tenantId,
          OR: searchTerms.map((term) => ({
            correlative: { contains: term, mode: 'insensitive' as const },
          })),
        },
        select: { id: true, correlative: true, status: true },
        take: 4,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.workOrder.findMany({
        where: {
          tenantId,
          OR: searchTerms.map((term) => ({
            correlative: { contains: term, mode: 'insensitive' as const },
          })),
        },
        select: { id: true, correlative: true, status: true },
        take: 4,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.equipment.findMany({
        where: {
          tenantId,
          OR: searchTerms.flatMap((term) => [
            { internalId: { contains: term, mode: 'insensitive' as const } },
            {
              mineInternalId: { contains: term, mode: 'insensitive' as const },
            },
            { plate: { contains: term, mode: 'insensitive' as const } },
            { brand: { contains: term, mode: 'insensitive' as const } },
            { model: { contains: term, mode: 'insensitive' as const } },
          ]),
        },
        select: {
          id: true,
          internalId: true,
          mineInternalId: true,
          plate: true,
          brand: true,
          model: true,
        },
        take: 5,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.inventoryItem.findMany({
        where: {
          tenantId,
          OR: searchTerms.flatMap((term) => [
            {
              inventoryCode: { contains: term, mode: 'insensitive' as const },
            },
            { partNumber: { contains: term, mode: 'insensitive' as const } },
            { qrCode: { contains: term, mode: 'insensitive' as const } },
            { name: { contains: term, mode: 'insensitive' as const } },
          ]),
        },
        select: { id: true, partNumber: true, name: true, inventoryCode: true },
        take: 48,
      }),
      this.prisma.warehouse.findMany({
        where: {
          tenantId,
          OR: searchTerms.flatMap((term) => [
            { code: { contains: term, mode: 'insensitive' as const } },
            { name: { contains: term, mode: 'insensitive' as const } },
            { location: { contains: term, mode: 'insensitive' as const } },
          ]),
        },
        select: { id: true, code: true, name: true, type: true },
        take: 5,
        orderBy: { code: 'asc' },
      }),
    ]);

    for (const req of docRows[0]) {
      results.push({
        kind: 'REQ',
        id: req.id,
        code: req.correlative,
        title: `REQ ${req.correlative} · ${req.status}`,
      });
    }
    for (const wr of docRows[1]) {
      results.push({
        kind: 'WR',
        id: wr.id,
        code: wr.correlative,
        title: `Recepción ${wr.correlative} · ${wr.status}`,
      });
    }
    for (const ot of docRows[2]) {
      results.push({
        kind: 'OT',
        id: ot.id,
        code: ot.correlative,
        title: `OT ${ot.correlative} · ${ot.status}`,
      });
    }
    for (const eq of docRows[3]) {
      const code = eq.internalId || eq.mineInternalId || eq.plate || eq.id;
      results.push({
        kind: 'EQUIP',
        id: eq.id,
        code,
        title: `Equipo ${code} · ${eq.brand} ${eq.model}`.trim(),
      });
    }
    const itemRankForGlobal = (
      normQuery: string,
      item: {
        partNumber: string | null;
        name: string;
        inventoryCode: string | null;
      },
    ): number => {
      const ic = (item.inventoryCode ?? '')
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '');
      const pn = (item.partNumber ?? '')
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '');
      if (normQuery.length < 2) return 0;
      if (ic && ic === normQuery) return 100;
      if (ic && ic.startsWith(normQuery)) return 85;
      if (ic && ic.includes(normQuery)) return 72;
      if (pn && pn === normQuery) return 68;
      if (pn && pn.startsWith(normQuery)) return 55;
      if (pn && pn.includes(normQuery)) return 45;
      return 20;
    };

    const normForItems =
      normalizedNoPrefix || normalized || q.replace(/[^A-Z0-9]/gi, '');
    const itemsSorted = [...docRows[4]]
      .map((item) => ({
        item,
        r: itemRankForGlobal(normForItems.toUpperCase(), item),
      }))
      .sort((a, b) => b.r - a.r)
      .slice(0, 6)
      .map((x) => x.item);

    for (const item of itemsSorted) {
      const sku = item.inventoryCode?.trim();
      results.push({
        kind: 'ITEM',
        id: item.id,
        code: sku || item.partNumber || item.id.slice(0, 8),
        title: sku
          ? `Repuesto ${sku}${item.partNumber ? ` · P/N ${item.partNumber}` : ''} · ${item.name}`
          : `${item.partNumber ? `Repuesto ${item.partNumber} · ` : ''}${item.name}`,
      });
    }
    for (const wh of docRows[5]) {
      results.push({
        kind: 'WH',
        id: wh.id,
        code: wh.code,
        title: `Bodega ${wh.code} · ${wh.name}`,
      });
    }

    const dedup = new Map<string, (typeof results)[number]>();
    for (const row of results) {
      dedup.set(`${row.kind}:${row.id}`, row);
    }
    const normQuery = normalizedNoPrefix || normalized || q;
    const relevance = (row: (typeof results)[number]): number => {
      const codeNorm = row.code.toUpperCase().replace(/[^A-Z0-9]/g, '');
      const titleNorm = row.title.toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (codeNorm === normQuery) return 100;
      if (codeNorm.startsWith(normQuery)) return 80;
      if (codeNorm.includes(normQuery)) return 60;
      if (titleNorm.includes(normQuery)) return 40;
      return 10;
    };
    const ordered = Array.from(dedup.values())
      .sort((a, b) => relevance(b) - relevance(a))
      .slice(0, 24);
    return { query, results: ordered };
  }

  private reportDateStamp(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private async loadTenantPdfBranding(tenantId: string) {
    const tenant = await this.prisma.tenant.findFirst({
      where: { id: tenantId },
      select: { name: true, pdfLogoUrl: true, primaryColor: true },
    });
    const tenantName = tenant?.name ?? 'Empresa';
    const tenantLogoDataUri = await fetchTenantPdfLogoDataUri(
      this.storage,
      tenant?.pdfLogoUrl,
    );
    return {
      tenantName,
      tenantLogoDataUri,
      tenantPrimaryColor: tenant?.primaryColor,
    };
  }

  /** Resumen ejecutivo por familia (misma vista del panel). */
  async getValuationSummaryReportBuffer(
    user: { tenantId: string },
    format: 'pdf' | 'xlsx',
  ): Promise<{ buffer: Buffer; filename: string; mimeType: string }> {
    const valuation = await this.getValuationByFamily(user);
    const { tenantName, tenantLogoDataUri, tenantPrimaryColor } =
      await this.loadTenantPdfBranding(user.tenantId);
    const data = {
      generatedAt: new Date(),
      grandTotal: valuation.grandTotal,
      byFamily: valuation.byFamily.map((f) => ({
        familyName: f.familyName,
        totalValue: f.totalValue,
      })),
    };
    const stamp = this.reportDateStamp();
    if (format === 'xlsx') {
      const buffer = await generateValuationSummaryXlsxBuffer(tenantName, data);
      return {
        buffer,
        filename: `valorizacion-familias-${stamp}.xlsx`,
        mimeType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      };
    }
    const buffer = await generateValuationSummaryPdfBuffer(tenantName, data, {
      tenantLogoDataUri,
      tenantPrimaryColor,
    });
    return {
      buffer,
      filename: `valorizacion-familias-${stamp}.pdf`,
      mimeType: 'application/pdf',
    };
  }

  async getFullReportMeta(user: { tenantId: string }) {
    const tenantId = user.tenantId;
    const [warehouses, valuation, catalogItemCount] = await Promise.all([
      this.prisma.warehouse.findMany({
        where: { tenantId },
        select: { id: true, code: true, name: true },
        orderBy: { code: 'asc' },
      }),
      this.getValuationByFamily(user),
      this.prisma.inventoryItem.count({ where: { tenantId } }),
    ]);
    return {
      warehouses,
      families: valuation.byFamily.map((f) => ({
        familyId: f.familyId,
        familyName: f.familyName,
        totalValue: f.totalValue,
      })),
      catalogItemCount,
      grandTotal: valuation.grandTotal,
    };
  }

  async getFullReportBuffer(
    user: { tenantId: string },
    format: 'pdf' | 'xlsx',
    reportOptions: ValuationFullReportOptions = defaultFullReportOptions(),
  ): Promise<{ buffer: Buffer; filename: string; mimeType: string }> {
    const raw = await this.buildFullReportData(user, reportOptions);
    const data = applyFullReportOptions(raw, reportOptions);
    const { tenantName, tenantLogoDataUri, tenantPrimaryColor } =
      await this.loadTenantPdfBranding(user.tenantId);
    const stamp = this.reportDateStamp();

    if (format === 'xlsx') {
      const buffer = await generateValuationFullReportXlsxBuffer(
        tenantName,
        data,
        {
          sections: reportOptions.sections,
          detailMaxRows: reportOptions.limits.detailMaxRows,
        },
      );
      return {
        buffer,
        filename: `valorizacion-maestro-${stamp}.xlsx`,
        mimeType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      };
    }

    const pdfDetailCap =
      reportOptions.limits.detailMaxRows ?? (format === 'pdf' ? 2500 : null);
    const buffer = await generateValuationFullReportPdfBuffer(
      tenantName,
      data,
      {
        tenantLogoDataUri,
        tenantPrimaryColor,
        sections: reportOptions.sections,
        detailMaxRows: pdfDetailCap,
      },
    );
    return {
      buffer,
      filename: `valorizacion-maestro-${stamp}.pdf`,
      mimeType: 'application/pdf',
    };
  }
}
