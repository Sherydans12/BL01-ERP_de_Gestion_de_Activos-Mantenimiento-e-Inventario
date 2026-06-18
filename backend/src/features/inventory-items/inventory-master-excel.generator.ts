import { InventoryItem } from '@prisma/client';
import {
  buildBaseLogicMasterWorkbook,
  type MasterExportCatalogSheet,
  type MasterExportColumn,
} from '../../common/excel/baselogic-master-export.util';

type InventoryExportItem = InventoryItem & {
  itemCategory: {
    name: string;
    parentCategory: { name: string } | null;
  };
  unitOfMeasure: {
    name: string;
    abbreviation: string;
    allowsDecimals: boolean;
  };
  inventorySupplier: { name: string } | null;
  policyTargetWarehouse: { code: string; name: string } | null;
  stocks: Array<{
    quantity: number;
    unitCost: unknown;
    minStock: number;
    maxStock: number;
    location: string | null;
    bin: { code: string; label: string | null } | null;
    warehouse: {
      code: string;
      name: string;
      location: string | null;
      contract: { code: string; name: string };
      subcontract: { code: string; name: string } | null;
    };
  }>;
};

type InventoryCategoryRow = {
  family: string;
  subcategory: string | null;
};

type InventoryWarehouseRow = {
  code: string;
  name: string;
  location: string | null;
  contractCode: string;
  subcontractCode: string | null;
};

type InventoryMasterExportData = {
  tenantName: string;
  generatedAt: Date;
  canViewCost: boolean;
  items: InventoryExportItem[];
  categories: InventoryCategoryRow[];
  units: Array<{ name: string; abbreviation: string; allowsDecimals: boolean }>;
  warehouses: InventoryWarehouseRow[];
  suppliers: Array<{ name: string }>;
};

type InventoryMasterRow = Record<string, unknown> & {
  quantity: number;
  lineValue?: number;
};

const BASE_COLUMNS: MasterExportColumn[] = [
  {
    header: 'ID articulo',
    key: 'id',
    width: 38,
    note: 'Identificador interno. No crear articulos desde Excel; use este valor solo para reconocer articulos existentes.',
  },
  {
    header: 'Codigo inventario',
    key: 'inventoryCode',
    width: 16,
    note: 'SKU interno ERP (IN####). Informativo; no se modifica desde importacion Excel.',
  },
  { header: 'Numero parte', key: 'partNumber', width: 18 },
  { header: 'Nombre', key: 'name', width: 32 },
  { header: 'Descripcion', key: 'description', width: 34 },
  { header: 'Familia', key: 'family', width: 24 },
  { header: 'Subcategoria', key: 'subcategory', width: 24 },
  { header: 'Unidad', key: 'unit', width: 12 },
  { header: 'Unidad nombre', key: 'unitName', width: 18 },
  {
    header: 'Permite decimales',
    key: 'allowsDecimals',
    width: 18,
    note: 'Informativo. Si dice NO, Stock/Stock minimo/Stock maximo deben ser enteros.',
  },
  { header: 'Marca', key: 'brand', width: 18 },
  { header: 'Compatibilidad', key: 'compatibilityInfo', width: 34 },
  { header: 'Proveedor habitual', key: 'supplier', width: 24 },
  { header: 'Inventariable', key: 'isInventory', width: 14 },
  { header: 'Consumible', key: 'isConsumable', width: 12 },
  { header: 'Activo', key: 'isAsset', width: 12 },
  { header: 'Serializado', key: 'isSerialized', width: 12 },
  { header: 'Bodega codigo', key: 'warehouseCode', width: 16 },
  { header: 'Bodega nombre', key: 'warehouseName', width: 24 },
  { header: 'Contrato', key: 'contractCode', width: 12 },
  { header: 'Subcontrato', key: 'subcontractCode', width: 14 },
  { header: 'Ubicacion stock', key: 'stockLocation', width: 18 },
  { header: 'Bin codigo', key: 'binCode', width: 14 },
  { header: 'Bin etiqueta', key: 'binLabel', width: 18 },
  { header: 'Stock', key: 'quantity', width: 12, numFmt: '#,##0.00' },
  { header: 'Stock minimo', key: 'minStock', width: 14, numFmt: '#,##0.00' },
  { header: 'Stock maximo', key: 'maxStock', width: 14, numFmt: '#,##0.00' },
  {
    header: 'Bodega politica',
    key: 'policyWarehouse',
    width: 20,
    note: 'Informativo. La politica estructural del articulo se edita dentro del sistema.',
  },
  {
    header: 'Politica minimo',
    key: 'policyMinStock',
    width: 14,
    numFmt: '#,##0.00',
  },
  {
    header: 'Politica maximo',
    key: 'policyMaxStock',
    width: 14,
    numFmt: '#,##0.00',
  },
  {
    header: 'QR payload',
    key: 'qrCode',
    width: 24,
    note: 'Payload interno para etiquetas y trazabilidad. Informativo; no se modifica desde Excel.',
  },
];

const COST_COLUMNS: MasterExportColumn[] = [
  { header: 'CPP', key: 'unitCost', width: 14, numFmt: '$#,##0.00' },
  {
    header: 'Valor linea',
    key: 'lineValue',
    width: 16,
    numFmt: '$#,##0.00',
    note: 'Informativo. Valor calculado con stock y CPP vigente.',
  },
];

function boolLabel(value: boolean): string {
  return value ? 'SI' : 'NO';
}

function numberFromDecimal(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === 'number') return value;
  if (
    typeof value === 'object' &&
    'toNumber' in value &&
    typeof value.toNumber === 'function'
  ) {
    return (value as { toNumber: () => number }).toNumber();
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function generateInventoryMasterExcelBuffer(
  data: InventoryMasterExportData,
): Promise<Buffer> {
  const columns = data.canViewCost
    ? [...BASE_COLUMNS.slice(0, 27), ...COST_COLUMNS, ...BASE_COLUMNS.slice(27)]
    : BASE_COLUMNS;

  const rows: InventoryMasterRow[] = data.items.flatMap(
    (item): InventoryMasterRow[] => {
      const family =
        item.itemCategory.parentCategory?.name ?? item.itemCategory.name;
      const subcategory = item.itemCategory.parentCategory
        ? item.itemCategory.name
        : null;
      const common = {
        id: item.id,
        inventoryCode: item.inventoryCode,
        partNumber: item.partNumber,
        name: item.name,
        description: item.description,
        family,
        subcategory,
        unit: item.unitOfMeasure.abbreviation,
        unitName: item.unitOfMeasure.name,
        allowsDecimals: boolLabel(item.unitOfMeasure.allowsDecimals),
        brand: item.brand,
        compatibilityInfo: item.compatibilityInfo,
        supplier: item.inventorySupplier?.name ?? null,
        isInventory: boolLabel(item.isInventory),
        isConsumable: boolLabel(item.isConsumable),
        isAsset: boolLabel(item.isAsset),
        isSerialized: boolLabel(item.isSerialized),
        policyWarehouse: item.policyTargetWarehouse
          ? `${item.policyTargetWarehouse.code} - ${item.policyTargetWarehouse.name}`
          : null,
        policyMinStock: item.policyMinStock,
        policyMaxStock: item.policyMaxStock,
        qrCode: item.qrCode,
      };

      if (item.stocks.length === 0) {
        return [
          {
            ...common,
            warehouseCode: null,
            warehouseName: null,
            contractCode: null,
            subcontractCode: null,
            stockLocation: null,
            binCode: null,
            binLabel: null,
            quantity: 0,
            minStock: null,
            maxStock: null,
            unitCost: data.canViewCost ? 0 : undefined,
            lineValue: data.canViewCost ? 0 : undefined,
          } satisfies InventoryMasterRow,
        ];
      }

      return item.stocks.map((stock) => {
        const unitCost = numberFromDecimal(stock.unitCost);
        return {
          ...common,
          warehouseCode: stock.warehouse.code,
          warehouseName: stock.warehouse.name,
          contractCode: stock.warehouse.contract.code,
          subcontractCode: stock.warehouse.subcontract?.code ?? null,
          stockLocation: stock.location,
          binCode: stock.bin?.code ?? null,
          binLabel: stock.bin?.label ?? null,
          quantity: stock.quantity,
          minStock: stock.minStock,
          maxStock: stock.maxStock,
          unitCost: data.canViewCost ? unitCost : undefined,
          lineValue: data.canViewCost ? stock.quantity * unitCost : undefined,
        } satisfies InventoryMasterRow;
      });
    },
  );

  const catalogs: MasterExportCatalogSheet[] = [
    {
      name: 'Catalogos inventario',
      columns: [
        { header: 'Catalogo', key: 'catalog', width: 20 },
        { header: 'Codigo', key: 'code', width: 18 },
        { header: 'Nombre', key: 'name', width: 34 },
        { header: 'Padre', key: 'parent', width: 24 },
        { header: 'Notas', key: 'notes', width: 34 },
      ],
      rows: [
        ...data.categories.map((category) => ({
          catalog: category.subcategory ? 'Subcategoria' : 'Familia',
          code: category.subcategory ?? category.family,
          name: category.subcategory ?? category.family,
          parent: category.subcategory ? category.family : null,
          notes: null,
        })),
        ...data.units.map((unit) => ({
          catalog: 'Unidad',
          code: unit.abbreviation,
          name: unit.name,
          parent: null,
          notes: unit.allowsDecimals ? 'Permite decimales' : 'Solo enteros',
        })),
        ...data.warehouses.map((warehouse) => ({
          catalog: 'Bodega',
          code: warehouse.code,
          name: warehouse.name,
          parent: warehouse.contractCode,
          notes: [
            warehouse.location,
            warehouse.subcontractCode
              ? `Subcontrato ${warehouse.subcontractCode}`
              : null,
          ]
            .filter(Boolean)
            .join(' | '),
        })),
        ...data.suppliers.map((supplier) => ({
          catalog: 'Proveedor habitual',
          code: supplier.name,
          name: supplier.name,
          parent: null,
          notes: null,
        })),
      ],
    },
  ];

  const stockedRows = rows.filter(
    (row) => Number(row.quantity ?? 0) > 0,
  ).length;
  const totalQty = rows.reduce(
    (acc, row) => acc + Number(row.quantity ?? 0),
    0,
  );
  const totalValue = data.canViewCost
    ? rows.reduce((acc, row) => acc + Number(row.lineValue ?? 0), 0)
    : 0;

  return buildBaseLogicMasterWorkbook({
    title: 'Maestro de Inventario',
    subtitle:
      'Extraccion profesional de articulos, bodegas, ubicaciones, stock y politicas.',
    domain: 'inventory',
    tenantName: data.tenantName,
    generatedAt: data.generatedAt,
    columns,
    rows,
    summary: [
      ['Articulos', data.items.length],
      ['Filas articulo/bodega', rows.length],
      ['Filas con stock positivo', stockedRows],
      ['Cantidad total', Number(totalQty.toFixed(2))],
      ...(data.canViewCost
        ? [['Valor total', Number(totalValue.toFixed(2))] as [string, number]]
        : []),
    ],
    notes: [
      'Uso oficial: ajustar stock por articulo existente y bodega existente. No crear, editar estructura ni borrar articulos desde Excel.',
      'Para crear o editar articulos use BaseLogic en Catalogo Maestro de Articulos; luego exporte nuevamente este Excel.',
      'Una fila representa un articulo en una bodega. Un articulo puede aparecer mas de una vez si tiene stock en varias bodegas.',
      'Campos permitidos para importacion: Bodega codigo, Ubicacion stock, Bin codigo, Stock, Stock minimo y Stock maximo.',
      'Campos estructurales como nombre, categoria, unidad, numero de parte, proveedor, flags, SKU y QR son informativos y cambios en ellos se rechazan al importar.',
      data.canViewCost
        ? 'El archivo incluye CPP y valor por linea porque el usuario tiene permiso de ver costos. CPP es informativo y no se modifica desde importacion Excel.'
        : 'El archivo no incluye costos porque el usuario no tiene permiso de ver costos.',
      'La hoja Catalogos inventario incluye familias, subcategorias, unidades, bodegas y proveedores habituales.',
    ],
    catalogs,
  });
}
