import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  generateValuationFullReportPdfBuffer,
  generateValuationFullReportXlsxBuffer,
  ValuationFullReportData,
} from './inventory-valuation-full-report.generator';

@Injectable()
export class InventoryAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

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
  async buildFullReportData(user: {
    tenantId: string;
  }): Promise<ValuationFullReportData> {
    const tenantId = user.tenantId;
    const generatedAt = new Date();

    const lineRows = await this.prisma.$queryRaw<
      {
        family_name: string;
        subcategory_name: string;
        part_number: string;
        item_name: string;
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
        ii.part_number,
        ii.name AS item_name,
        COALESCE(SUM(s.quantity), 0)::double precision AS total_qty,
        COALESCE(SUM(s.quantity * COALESCE(s.unit_cost, 0)), 0)::decimal AS total_val
      FROM inventory_items ii
      INNER JOIN item_categories leaf ON leaf.id = ii.category_id
      LEFT JOIN item_categories par ON par.id = leaf.parent_category_id
      LEFT JOIN item_stocks s ON s.item_id = ii.id
      LEFT JOIN warehouses w ON w.id = s.warehouse_id AND w.tenant_id = ii.tenant_id
      WHERE ii.tenant_id = ${tenantId}::uuid
      GROUP BY
        ii.id,
        par.name,
        leaf.name,
        leaf.parent_category_id,
        ii.part_number,
        ii.name
      ORDER BY family_name ASC, subcategory_name ASC, ii.part_number ASC
    `);

    const lines = lineRows.map((r) => {
      const totalQty = Number(r.total_qty);
      const totalVal = Number(r.total_val);
      const cpp = totalQty > 1e-9 ? totalVal / totalQty : 0;
      return {
        familyName: r.family_name,
        subcategoryName: r.subcategory_name,
        partNumber: r.part_number,
        itemName: r.item_name,
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
    `);
    const itemsBelowMinCount = Number(belowRows[0]?.c ?? 0);

    const whRows = await this.prisma.$queryRaw<
      { code: string; name: string; total_value: unknown }[]
    >(Prisma.sql`
      SELECT
        w.code,
        w.name,
        COALESCE(SUM(s.quantity * COALESCE(s.unit_cost, 0)), 0)::decimal AS total_value
      FROM warehouses w
      LEFT JOIN item_stocks s ON s.warehouse_id = w.id
      WHERE w.tenant_id = ${tenantId}::uuid
      GROUP BY w.id, w.code, w.name
      ORDER BY w.code ASC
    `);

    const byWarehouse = whRows.map((r) => ({
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
          COALESCE(parent.name, leaf.name) AS family_name,
          COALESCE(SUM(s.quantity), 0)::double precision AS current_stock,
          COALESCE(MAX(s.min_stock), 0)::double precision AS min_stock
        FROM inventory_items ii
        INNER JOIN item_categories leaf ON leaf.id = ii.category_id
        LEFT JOIN item_categories parent ON parent.id = leaf.parent_category_id
        LEFT JOIN item_stocks s ON s.item_id = ii.id
        WHERE ii.tenant_id = ${tenantId}::uuid
        GROUP BY ii.id, ii.part_number, ii.name, parent.name, leaf.name
      )
      SELECT
        item_id,
        part_number,
        item_name,
        family_name,
        current_stock,
        min_stock,
        (min_stock - current_stock)::double precision AS risk_gap
      FROM stock_by_item
      WHERE min_stock > 0 AND current_stock < min_stock
      ORDER BY (min_stock - current_stock) DESC, current_stock ASC
      LIMIT 10
    `);

    const criticalItems = criticalRows.map((r) => ({
      itemId: r.item_id,
      partNumber: r.part_number,
      itemName: r.item_name,
      familyName: r.family_name,
      currentStock: Number(r.current_stock),
      minStock: Number(r.min_stock),
      riskGap: Number(r.risk_gap),
    }));

    const deadStockRows = await this.prisma.$queryRaw<
      {
        item_id: string;
        part_number: string;
        item_name: string;
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
          COALESCE(parent.name, leaf.name) AS family_name,
          COALESCE(SUM(s.quantity), 0)::double precision AS total_qty,
          COALESCE(SUM(s.quantity * COALESCE(s.unit_cost, 0)), 0)::decimal AS total_val,
          lm.last_move_at
        FROM inventory_items ii
        INNER JOIN item_categories leaf ON leaf.id = ii.category_id
        LEFT JOIN item_categories parent ON parent.id = leaf.parent_category_id
        LEFT JOIN item_stocks s ON s.item_id = ii.id
        LEFT JOIN last_move lm ON lm.item_id = ii.id
        WHERE ii.tenant_id = ${tenantId}::uuid
        GROUP BY ii.id, ii.part_number, ii.name, parent.name, leaf.name, lm.last_move_at
      )
      SELECT
        item_id,
        part_number,
        item_name,
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
      LIMIT 20
    `);

    const deadStockItems = deadStockRows.map((r) => ({
      itemId: r.item_id,
      partNumber: r.part_number,
      itemName: r.item_name,
      familyName: r.family_name,
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
        take: 100,
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
      purchaseRequisitionExportRows: purchaseRequisitionExportRows.map(
        (r) => ({
          correlative: r.correlative,
          status: r.status,
          ocVendorDetail: r.purchaseOrders
            .map((po) => {
              const vn =
                po.quotation?.vendor?.name ??
                po.quotation?.vendor?.code ??
                '—';
              return `${po.correlative} — ${vn} — ${po.status}`;
            })
            .join(' | '),
        }),
      ),
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
      v.replace(
        /^(OC|PO|INV|FAC|REQ|WR|OT|WO|EQ|EQP|REP|WH|BOD)[\s\-_:]*/i,
        '',
      ).trim();
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
            { mineInternalId: { contains: term, mode: 'insensitive' as const } },
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
            { partNumber: { contains: term, mode: 'insensitive' as const } },
            { qrCode: { contains: term, mode: 'insensitive' as const } },
            { name: { contains: term, mode: 'insensitive' as const } },
          ]),
        },
        select: { id: true, partNumber: true, name: true },
        take: 6,
        orderBy: { partNumber: 'asc' },
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
    for (const item of docRows[4]) {
      results.push({
        kind: 'ITEM',
        id: item.id,
        code: item.partNumber,
        title: `Repuesto ${item.partNumber} · ${item.name}`,
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

  async getFullReportBuffer(
    user: { tenantId: string },
    format: 'pdf' | 'xlsx',
  ): Promise<{ buffer: Buffer; filename: string; mimeType: string }> {
    const data = await this.buildFullReportData(user);
    const tenant = await this.prisma.tenant.findFirst({
      where: { id: user.tenantId },
      select: { name: true },
    });
    const tenantName = tenant?.name ?? 'Empresa';

    if (format === 'xlsx') {
      const buffer = await generateValuationFullReportXlsxBuffer(
        tenantName,
        data,
      );
      return {
        buffer,
        filename: `valorizacion-maestro-${Date.now()}.xlsx`,
        mimeType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      };
    }

    const buffer = await generateValuationFullReportPdfBuffer(tenantName, data);
    return {
      buffer,
      filename: `valorizacion-maestro-${Date.now()}.pdf`,
      mimeType: 'application/pdf',
    };
  }
}
