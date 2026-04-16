import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';

export type ValuationFullReportRow = {
  familyName: string;
  subcategoryName: string;
  partNumber: string;
  itemName: string;
  totalQty: number;
  cpp: number;
  lineValue: number;
};

export type ValuationFullReportWarehouseSummary = {
  warehouseCode: string;
  warehouseName: string;
  totalValue: number;
};

export type ValuationFullReportData = {
  generatedAt: Date;
  lines: ValuationFullReportRow[];
  itemsBelowMinCount: number;
  byWarehouse: ValuationFullReportWarehouseSummary[];
  byFamily: Array<{ familyName: string; totalValue: number }>;
  inventoryGrandTotal: number;
  criticalItems: Array<{
    itemId: string;
    partNumber: string;
    itemName: string;
    familyName: string;
    currentStock: number;
    minStock: number;
    riskGap: number;
  }>;
  deadStockItems: Array<{
    itemId: string;
    partNumber: string;
    itemName: string;
    familyName: string;
    quantity: number;
    totalValue: number;
  }>;
  immobilizedCapital: number;
  /** SRC activos con desglose OC / proveedor (multiproveedor). */
  purchaseRequisitionExportRows?: Array<{
    correlative: string;
    status: string;
    ocVendorDetail: string;
  }>;
};

function formatMoney(n: number): string {
  try {
    return `$ ${n.toLocaleString('es-CL', { maximumFractionDigits: 2 })}`;
  } catch {
    return `$ ${n}`;
  }
}

export function generateValuationFullReportPdfBuffer(
  tenantName: string,
  data: ValuationFullReportData,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 40,
      layout: 'landscape',
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = doc.page.margins.left;
    const width =
      doc.page.width - doc.page.margins.left - doc.page.margins.right;

    doc.fontSize(14).fillColor('#111').text(tenantName, left, doc.y, { width });
    doc.moveDown(0.2);
    doc
      .fontSize(16)
      .fillColor('#0a0a0a')
      .text('Estado de situacion de inventario', {
        align: 'center',
        width,
      });
    doc.moveDown(0.3);
    doc
      .fontSize(9)
      .fillColor('#555')
      .text(
        `Generado: ${data.generatedAt.toLocaleString('es-CL', {
          dateStyle: 'short',
          timeStyle: 'short',
        })}`,
        { align: 'center', width },
      );
    doc.moveDown(0.8);

    doc.fontSize(10).fillColor('#222').text('Resumen', left);
    doc.moveDown(0.2);
    doc.fontSize(9).fillColor('#333');
    doc.text(
      `Ítems con saldo en o bajo stock mínimo (al menos una bodega): ${data.itemsBelowMinCount}`,
      left,
    );
    doc.text(
      `Valor total inventario: ${formatMoney(data.inventoryGrandTotal)}`,
      left,
    );
    doc.moveDown(0.5);

    doc.fontSize(10).text('Valor por bodega', left);
    doc.moveDown(0.2);
    doc.fontSize(8);
    for (const w of data.byWarehouse) {
      doc.text(
        `${w.warehouseCode} — ${w.warehouseName}: ${formatMoney(w.totalValue)}`,
        left,
        doc.y,
        { width },
      );
    }
    doc.moveDown(0.6);

    doc.fontSize(10).text('Valorizacion por familia', left);
    doc.moveDown(0.2);
    doc.fontSize(8);
    for (const f of data.byFamily) {
      doc.text(`${f.familyName}: ${formatMoney(f.totalValue)}`, left, doc.y, {
        width,
      });
    }
    doc.moveDown(0.6);

    doc.fontSize(10).text('Top 10 items criticos (stock < minimo)', left);
    doc.moveDown(0.2);
    doc.fontSize(8);
    if (!data.criticalItems.length) {
      doc.text('Sin items criticos para el corte.', left);
    } else {
      for (const c of data.criticalItems) {
        doc.text(
          `${c.partNumber} | ${c.itemName.slice(0, 30)} | ${c.familyName.slice(0, 20)} | Stock ${c.currentStock.toLocaleString('es-CL')} / Min ${c.minStock.toLocaleString('es-CL')}`,
          left,
          doc.y,
          { width },
        );
      }
    }
    doc.moveDown(0.6);

    doc
      .fontSize(10)
      .text('Capital inmovilizado (sin movimientos 6 meses)', left);
    doc.moveDown(0.2);
    doc
      .fontSize(9)
      .text(
        `Capital inmovilizado total: ${formatMoney(data.immobilizedCapital)}`,
        left,
      );
    doc.moveDown(0.2);
    doc.fontSize(8);
    if (!data.deadStockItems.length) {
      doc.text('Sin stock muerto detectado en el periodo.', left);
    } else {
      for (const d of data.deadStockItems.slice(0, 12)) {
        doc.text(
          `${d.partNumber} | ${d.itemName.slice(0, 28)} | ${d.familyName.slice(0, 18)} | Qty ${d.quantity.toLocaleString('es-CL', { maximumFractionDigits: 2 })} | ${formatMoney(d.totalValue)}`,
          left,
          doc.y,
          { width },
        );
      }
    }
    doc.moveDown(0.6);

    doc.fontSize(10).text('Detalle por artículo', left);
    doc.moveDown(0.3);
    doc.fontSize(6).fillColor('#333');

    for (const row of data.lines) {
      if (doc.y > doc.page.height - doc.page.margins.bottom - 24) {
        doc.addPage();
        doc.fontSize(6).fillColor('#333');
      }
      const line = [
        row.familyName.slice(0, 28),
        row.subcategoryName.slice(0, 28),
        row.partNumber.slice(0, 18),
        row.itemName.slice(0, 40),
        row.totalQty.toLocaleString('es-CL', { maximumFractionDigits: 2 }),
        formatMoney(row.cpp),
        formatMoney(row.lineValue),
      ].join('  |  ');
      doc.text(line, left, doc.y, { width, lineGap: 1 });
    }

    const prRows = data.purchaseRequisitionExportRows ?? [];
    if (prRows.length > 0) {
      doc.addPage();
      doc.fontSize(10).fillColor('#222').text('Requerimientos y OCs (compras)', left);
      doc.moveDown(0.3);
      doc.fontSize(7).fillColor('#555');
      doc.text(
        'Cada fila lista el SRC y las órdenes activas con proveedor (compra fragmentada).',
        left,
        doc.y,
        { width },
      );
      doc.moveDown(0.5);
      doc.fontSize(7).fillColor('#333');
      for (const pr of prRows.slice(0, 40)) {
        if (doc.y > doc.page.height - doc.page.margins.bottom - 36) {
          doc.addPage();
          doc.fontSize(7).fillColor('#333');
        }
        const det = pr.ocVendorDetail?.trim() || 'Sin OC activa';
        doc.text(`${pr.correlative} · ${pr.status}: ${det}`, left, doc.y, {
          width,
          lineGap: 1,
        });
        doc.moveDown(0.35);
      }
    }

    doc.end();
  });
}

export async function generateValuationFullReportXlsxBuffer(
  tenantName: string,
  data: ValuationFullReportData,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ERP Inventario';
  wb.created = data.generatedAt;

  const ws = wb.addWorksheet('Detalle', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  ws.columns = [
    { header: 'Familia', key: 'family', width: 22 },
    { header: 'Subcategoría', key: 'sub', width: 22 },
    { header: 'Nº parte', key: 'pn', width: 16 },
    { header: 'Ítem', key: 'name', width: 36 },
    { header: 'Stock total', key: 'qty', width: 12 },
    { header: 'CPP', key: 'cpp', width: 14 },
    { header: 'Valor total', key: 'val', width: 16 },
  ];
  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE8E8E8' },
  };

  for (const r of data.lines) {
    ws.addRow({
      family: r.familyName,
      sub: r.subcategoryName,
      pn: r.partNumber,
      name: r.itemName,
      qty: r.totalQty,
      cpp: r.cpp,
      val: r.lineValue,
    });
  }

  const sum = wb.addWorksheet('Resumen');
  sum.addRow([tenantName]);
  sum.addRow([
    'Generado',
    data.generatedAt.toLocaleString('es-CL', {
      dateStyle: 'short',
      timeStyle: 'short',
    }),
  ]);
  sum.addRow([]);
  sum.addRow([
    'Ítems en/bajo stock mínimo (≥1 bodega)',
    data.itemsBelowMinCount,
  ]);
  sum.addRow(['Valor total inventario', data.inventoryGrandTotal]);
  sum.addRow([]);
  sum.addRow(['Bodega', 'Código', 'Valor']);
  for (const w of data.byWarehouse) {
    sum.addRow([w.warehouseName, w.warehouseCode, w.totalValue]);
  }
  sum.addRow([]);
  sum.addRow(['Familia', 'Valor']);
  for (const f of data.byFamily) {
    sum.addRow([f.familyName, f.totalValue]);
  }
  sum.addRow([]);
  sum.addRow(['Capital inmovilizado', data.immobilizedCapital]);
  sum.addRow([]);
  sum.addRow([
    'Top críticos',
    'N° Parte',
    'Ítem',
    'Familia',
    'Stock',
    'Mínimo',
    'Brecha',
  ]);
  for (const c of data.criticalItems) {
    sum.addRow([
      '',
      c.partNumber,
      c.itemName,
      c.familyName,
      c.currentStock,
      c.minStock,
      c.riskGap,
    ]);
  }

  const prRows = data.purchaseRequisitionExportRows ?? [];
  if (prRows.length > 0) {
    const wsPr = wb.addWorksheet('Compras SRC', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    wsPr.columns = [
      { header: 'Requerimiento', key: 'req', width: 16 },
      { header: 'Estado SRC', key: 'st', width: 22 },
      {
        header: 'OC y proveedores (activas)',
        key: 'detail',
        width: 80,
      },
    ];
    const h = wsPr.getRow(1);
    h.font = { bold: true };
    h.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0F2FE' },
    };
    for (const pr of prRows) {
      wsPr.addRow({
        req: pr.correlative,
        st: pr.status,
        detail: pr.ocVendorDetail || '—',
      });
    }
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
