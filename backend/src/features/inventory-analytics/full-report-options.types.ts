/** Secciones incluibles en el reporte maestro de valorización. */
export type ValuationFullReportSections = {
  warehouseSummary: boolean;
  familySummary: boolean;
  criticalItems: boolean;
  deadStock: boolean;
  itemDetail: boolean;
  purchases: boolean;
};

export type ValuationFullReportFilters = {
  /** Si vacío o null → todas las bodegas del tenant. */
  warehouseIds: string[] | null;
  /** Si vacío o null → todas las familias. */
  familyNames: string[] | null;
  /** Solo líneas con stock total &gt; 0. */
  onlyWithStock: boolean;
};

export type ValuationFullReportLimits = {
  /** null = sin tope (Excel) o tope PDF por defecto en generador. */
  detailMaxRows: number | null;
  criticalMaxRows: number;
  deadStockMaxRows: number;
  purchaseMaxRows: number;
};

export type ValuationFullReportOptions = {
  sections: ValuationFullReportSections;
  filters: ValuationFullReportFilters;
  limits: ValuationFullReportLimits;
};

export const DEFAULT_FULL_REPORT_SECTIONS: ValuationFullReportSections = {
  warehouseSummary: true,
  familySummary: true,
  criticalItems: true,
  deadStock: true,
  itemDetail: true,
  purchases: true,
};

export const DEFAULT_FULL_REPORT_LIMITS: ValuationFullReportLimits = {
  detailMaxRows: null,
  criticalMaxRows: 10,
  deadStockMaxRows: 20,
  purchaseMaxRows: 100,
};

export function defaultFullReportOptions(): ValuationFullReportOptions {
  return {
    sections: { ...DEFAULT_FULL_REPORT_SECTIONS },
    filters: {
      warehouseIds: null,
      familyNames: null,
      onlyWithStock: false,
    },
    limits: { ...DEFAULT_FULL_REPORT_LIMITS },
  };
}
