import type { ValuationFullReportData } from './inventory-valuation-full-report.generator';
import type { ValuationFullReportOptions } from './full-report-options.types';

/** Aplica filtros y recorta datos según opciones del reporte maestro. */
export function applyFullReportOptions(
  data: ValuationFullReportData,
  options: ValuationFullReportOptions,
): ValuationFullReportData {
  const { filters, limits, sections } = options;

  let lines = [...data.lines];
  let byWarehouse = [...data.byWarehouse];
  let byFamily = [...data.byFamily];

  if (filters.familyNames?.length) {
    const families = new Set(filters.familyNames);
    lines = lines.filter((l) => families.has(l.familyName));
    byFamily = byFamily.filter((f) => families.has(f.familyName));
  }

  if (filters.onlyWithStock) {
    lines = lines.filter((l) => l.totalQty > 1e-9);
  }

  if (filters.warehouseIds?.length) {
    const wh = new Set(filters.warehouseIds);
    byWarehouse = byWarehouse.filter((w) => wh.has(w.warehouseId));
  }

  let criticalItems = sections.criticalItems ? [...data.criticalItems] : [];
  let deadStockItems = sections.deadStock ? [...data.deadStockItems] : [];

  if (filters.familyNames?.length) {
    const families = new Set(filters.familyNames);
    criticalItems = criticalItems.filter((c) => families.has(c.familyName));
    deadStockItems = deadStockItems.filter((d) => families.has(d.familyName));
  }

  criticalItems = criticalItems.slice(0, limits.criticalMaxRows);
  deadStockItems = deadStockItems.slice(0, limits.deadStockMaxRows);

  const immobilizedCapital = deadStockItems.reduce(
    (sum, row) => sum + row.totalValue,
    0,
  );

  const purchaseRequisitionExportRows = sections.purchases
    ? (data.purchaseRequisitionExportRows ?? []).slice(
        0,
        limits.purchaseMaxRows,
      )
    : [];

  if (!sections.itemDetail) {
    lines = [];
  }

  if (!sections.warehouseSummary) {
    byWarehouse = [];
  }
  if (!sections.familySummary) {
    byFamily = [];
  }

  const inventoryGrandTotal =
    byWarehouse.length > 0
      ? byWarehouse.reduce((s, w) => s + w.totalValue, 0)
      : lines.reduce((s, l) => s + l.lineValue, 0);

  return {
    ...data,
    lines,
    byWarehouse,
    byFamily,
    criticalItems,
    deadStockItems,
    immobilizedCapital,
    purchaseRequisitionExportRows,
    inventoryGrandTotal,
  };
}
