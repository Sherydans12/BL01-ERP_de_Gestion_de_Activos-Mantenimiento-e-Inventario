import ExcelJS from 'exceljs';

export type MasterExportColumn = {
  header: string;
  key: string;
  width?: number;
  note?: string;
  numFmt?: string;
};

export type MasterExportCatalogSheet = {
  name: string;
  columns: MasterExportColumn[];
  rows: Record<string, unknown>[];
};

export type MasterExportOptions = {
  title: string;
  subtitle: string;
  domain: 'fleet' | 'inventory';
  tenantName: string;
  generatedAt: Date;
  columns: MasterExportColumn[];
  rows: Record<string, unknown>[];
  summary: Array<[string, string | number]>;
  notes: string[];
  catalogs?: MasterExportCatalogSheet[];
};

const COLORS = {
  navy: 'FF0F172A',
  surface: 'FF111827',
  cyan: 'FF00E5FF',
  cyanSoft: 'FFE0F7FA',
  text: 'FF0F172A',
  muted: 'FF64748B',
  border: 'FFCBD5E1',
  header: 'FF0B1220',
  headerText: 'FFFFFFFF',
  warning: 'FFFFF7ED',
};

function asExcelValue(value: unknown): ExcelJS.CellValue {
  if (value == null) return null;
  if (value instanceof Date) return value;
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  return JSON.stringify(value);
}

function styleHeaderRow(row: ExcelJS.Row): void {
  row.height = 22;
  row.eachCell((cell) => {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: COLORS.header },
    };
    cell.font = {
      name: 'Calibri',
      size: 10,
      bold: true,
      color: { argb: COLORS.headerText },
    };
    cell.alignment = {
      vertical: 'middle',
      horizontal: 'center',
      wrapText: true,
    };
    cell.border = {
      top: { style: 'thin', color: { argb: COLORS.border } },
      left: { style: 'thin', color: { argb: COLORS.border } },
      bottom: { style: 'thin', color: { argb: COLORS.border } },
      right: { style: 'thin', color: { argb: COLORS.border } },
    };
  });
}

function styleDataSheet(
  ws: ExcelJS.Worksheet,
  columns: MasterExportColumn[],
  rows: Record<string, unknown>[],
): void {
  ws.views = [{ state: 'frozen', ySplit: 5 }];
  ws.properties.defaultRowHeight = 18;

  ws.columns = columns.map((col) => ({
    header: col.header,
    key: col.key,
    width: col.width ?? 18,
  }));

  ws.spliceRows(1, 0, [], [], [], []);
  ws.getCell('A1').value = 'BaseLogic';
  ws.getCell('A1').font = {
    name: 'Consolas',
    size: 11,
    bold: true,
    color: { argb: COLORS.cyan },
  };
  ws.getCell('A2').value = ws.name;
  ws.getCell('A2').font = {
    name: 'Calibri',
    size: 16,
    bold: true,
    color: { argb: COLORS.text },
  };
  ws.getCell('A3').value =
    'Hoja profesional editable para extraccion/importacion controlada.';
  ws.getCell('A3').font = {
    name: 'Calibri',
    size: 10,
    color: { argb: COLORS.muted },
  };
  ws.mergeCells(1, 1, 1, Math.max(1, columns.length));
  ws.mergeCells(2, 1, 2, Math.max(1, columns.length));
  ws.mergeCells(3, 1, 3, Math.max(1, columns.length));

  const headerRow = ws.getRow(5);
  for (let i = 0; i < columns.length; i += 1) {
    const col = columns[i];
    const cell = headerRow.getCell(i + 1);
    cell.value = col.header;
    if (col.note) {
      cell.note = {
        texts: [{ text: col.note }],
      };
    }
  }
  styleHeaderRow(headerRow);

  for (const row of rows) {
    const added = ws.addRow(columns.map((col) => asExcelValue(row[col.key])));
    added.eachCell((cell, colNumber) => {
      const col = columns[colNumber - 1];
      cell.font = { name: 'Calibri', size: 10, color: { argb: COLORS.text } };
      cell.alignment = { vertical: 'top', wrapText: true };
      cell.border = {
        bottom: { style: 'hair', color: { argb: COLORS.border } },
      };
      if (col?.numFmt) cell.numFmt = col.numFmt;
    });
  }

  ws.autoFilter = {
    from: { row: 5, column: 1 },
    to: { row: Math.max(5, rows.length + 5), column: columns.length },
  };
}

function addSummarySheet(
  wb: ExcelJS.Workbook,
  options: MasterExportOptions,
): void {
  const ws = wb.addWorksheet('Resumen', {
    views: [{ state: 'frozen', ySplit: 6 }],
  });
  ws.columns = [{ width: 28 }, { width: 36 }, { width: 18 }, { width: 18 }];

  ws.mergeCells('A1:D1');
  ws.getCell('A1').value = 'BaseLogic';
  ws.getCell('A1').font = {
    name: 'Consolas',
    size: 12,
    bold: true,
    color: { argb: COLORS.cyan },
  };
  ws.getCell('A1').fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: COLORS.navy },
  };
  ws.getCell('A1').alignment = { vertical: 'middle', horizontal: 'left' };
  ws.getRow(1).height = 24;

  ws.mergeCells('A2:D2');
  ws.getCell('A2').value = options.title;
  ws.getCell('A2').font = {
    name: 'Calibri',
    size: 18,
    bold: true,
    color: { argb: COLORS.text },
  };
  ws.getRow(2).height = 26;

  ws.mergeCells('A3:D3');
  ws.getCell('A3').value = options.subtitle;
  ws.getCell('A3').font = {
    name: 'Calibri',
    size: 10,
    color: { argb: COLORS.muted },
  };

  ws.addRow([]);
  ws.addRow(['Empresa', options.tenantName]);
  ws.addRow(['Generado', options.generatedAt]);
  ws.getCell('B6').numFmt = 'yyyy-mm-dd hh:mm';
  ws.addRow([]);

  const summaryStart = ws.rowCount + 1;
  ws.addRow(['Indicador', 'Valor']);
  styleHeaderRow(ws.getRow(summaryStart));
  for (const [label, value] of options.summary) {
    ws.addRow([label, value]);
  }

  ws.addRow([]);
  const notesHeader = ws.rowCount + 1;
  ws.addRow(['Notas operativas']);
  ws.mergeCells(notesHeader, 1, notesHeader, 4);
  styleHeaderRow(ws.getRow(notesHeader));
  for (const note of options.notes) {
    const r = ws.addRow([note]);
    ws.mergeCells(r.number, 1, r.number, 4);
    r.getCell(1).alignment = { wrapText: true, vertical: 'top' };
  }
}

function addCatalogSheet(
  wb: ExcelJS.Workbook,
  catalog: MasterExportCatalogSheet,
): void {
  const ws = wb.addWorksheet(catalog.name, {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  ws.columns = catalog.columns.map((col) => ({
    header: col.header,
    key: col.key,
    width: col.width ?? 22,
  }));
  styleHeaderRow(ws.getRow(1));
  for (const row of catalog.rows) {
    ws.addRow(catalog.columns.map((col) => asExcelValue(row[col.key])));
  }
  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: {
      row: Math.max(1, catalog.rows.length + 1),
      column: catalog.columns.length,
    },
  };
}

function addHiddenContractSheet(
  wb: ExcelJS.Workbook,
  options: MasterExportOptions,
): void {
  const ws = wb.addWorksheet('_bl_import_contract');
  ws.state = 'veryHidden';
  ws.addRows([
    ['domain', options.domain],
    ['version', '1'],
    ['generatedAt', options.generatedAt.toISOString()],
    ['primarySheet', options.domain === 'fleet' ? 'Flota' : 'Inventario'],
    ['headerRow', 5],
    ['firstDataRow', 6],
  ]);
}

export async function buildBaseLogicMasterWorkbook(
  options: MasterExportOptions,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'BaseLogic-EAM';
  wb.company = 'BaseLogic';
  wb.subject = options.subtitle;
  wb.title = options.title;
  wb.created = options.generatedAt;
  wb.modified = options.generatedAt;

  addSummarySheet(wb, options);

  const dataSheet = wb.addWorksheet(
    options.domain === 'fleet' ? 'Flota' : 'Inventario',
  );
  styleDataSheet(dataSheet, options.columns, options.rows);

  for (const catalog of options.catalogs ?? []) {
    addCatalogSheet(wb, catalog);
  }

  addHiddenContractSheet(wb, options);

  const raw = await wb.xlsx.writeBuffer();
  return Buffer.from(raw);
}
