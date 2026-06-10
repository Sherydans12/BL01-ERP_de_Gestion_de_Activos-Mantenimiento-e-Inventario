/** Opciones de personalización del reporte maestro (espejo del query backend). */
export interface InventoryMasterReportSections {
  warehouseSummary: boolean;
  familySummary: boolean;
  criticalItems: boolean;
  deadStock: boolean;
  itemDetail: boolean;
  purchases: boolean;
}

export interface InventoryMasterReportOptions {
  sections: InventoryMasterReportSections;
  warehouseIds: string[];
  familyNames: string[];
  onlyWithStock: boolean;
  detailMaxRows: number | null;
  criticalMaxRows: number;
  deadStockMaxRows: number;
  purchaseMaxRows: number;
}

export const INVENTORY_MASTER_REPORT_STORAGE_KEY =
  'bl01.inventoryMasterReport.v1';

export function defaultMasterReportOptions(): InventoryMasterReportOptions {
  return {
    sections: {
      warehouseSummary: true,
      familySummary: true,
      criticalItems: true,
      deadStock: true,
      itemDetail: true,
      purchases: true,
    },
    warehouseIds: [],
    familyNames: [],
    onlyWithStock: false,
    detailMaxRows: null,
    criticalMaxRows: 10,
    deadStockMaxRows: 20,
    purchaseMaxRows: 100,
  };
}

export type MasterReportPresetId =
  | 'full'
  | 'executive'
  | 'critical'
  | 'catalog';

export const MASTER_REPORT_PRESETS: Record<
  MasterReportPresetId,
  { label: string; description: string; options: InventoryMasterReportOptions }
> = {
  full: {
    label: 'Completo',
    description: 'Todas las secciones, sin filtros.',
    options: defaultMasterReportOptions(),
  },
  executive: {
    label: 'Ejecutivo',
    description: 'Resúmenes y alertas; sin detalle ni compras.',
    options: {
      ...defaultMasterReportOptions(),
      sections: {
        warehouseSummary: true,
        familySummary: true,
        criticalItems: true,
        deadStock: true,
        itemDetail: false,
        purchases: false,
      },
    },
  },
  critical: {
    label: 'Abastecimiento',
    description: 'Bodegas, familias e ítems críticos.',
    options: {
      ...defaultMasterReportOptions(),
      sections: {
        warehouseSummary: true,
        familySummary: true,
        criticalItems: true,
        deadStock: false,
        itemDetail: false,
        purchases: false,
      },
      criticalMaxRows: 50,
    },
  },
  catalog: {
    label: 'Catálogo con stock',
    description: 'Solo detalle de artículos con saldo > 0.',
    options: {
      ...defaultMasterReportOptions(),
      sections: {
        warehouseSummary: false,
        familySummary: true,
        criticalItems: false,
        deadStock: false,
        itemDetail: true,
        purchases: false,
      },
      onlyWithStock: true,
      detailMaxRows: 5000,
    },
  },
};
