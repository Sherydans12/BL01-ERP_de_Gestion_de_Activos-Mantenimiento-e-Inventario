import ExcelJS from 'exceljs';
import type { ValuationFullReportSections } from './full-report-options.types';
import {
  buildLogoBlockHtml,
  buildPdfDocumentBaseCss,
  escapeHtml,
  formatClp,
  formatDateTimeEs,
  pdfElectronicFootNoteHtml,
  PDF_DOC_STATUS_CSS,
  renderHtmlToPdfBuffer,
  resolveTenantAccent,
} from '../../common/pdf/pdf-html-shared';

export type ValuationFullReportRow = {
  familyName: string;
  subcategoryName: string;
  inventoryCode: string;
  partNumber: string;
  itemName: string;
  itemDescription: string;
  totalQty: number;
  cpp: number;
  lineValue: number;
};

export type ValuationFullReportWarehouseSummary = {
  warehouseId: string;
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
    itemDescription: string;
    familyName: string;
    currentStock: number;
    minStock: number;
    riskGap: number;
  }>;
  deadStockItems: Array<{
    itemId: string;
    partNumber: string;
    itemName: string;
    itemDescription: string;
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

export type ValuationFullReportRenderOptions = {
  tenantLogoDataUri?: string | null;
  tenantPrimaryColor?: string | null;
  sections?: ValuationFullReportSections;
  detailMaxRows?: number | null;
};

/** @deprecated alias */
export type ValuationFullReportPdfOptions = ValuationFullReportRenderOptions;

const ALL_SECTIONS: ValuationFullReportSections = {
  warehouseSummary: true,
  familySummary: true,
  criticalItems: true,
  deadStock: true,
  itemDetail: true,
  purchases: true,
};

/** Límite de filas en PDF para evitar timeouts de Chromium con catálogos muy grandes. */
const PDF_DETAIL_LINE_CAP = 2500;

const SRC_STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Borrador',
  PENDING_APPROVAL: 'Pendiente aprobación',
  APPROVED: 'Aprobado',
  REJECTED: 'Rechazado',
  CANCELLED: 'Anulado',
  PARTIALLY_ORDERED: 'OC parcial',
  FULLY_ORDERED: 'OC completa',
  CLOSED: 'Cerrado',
};

function labelSrcStatus(status: string): string {
  return SRC_STATUS_LABEL[status] ?? status.replace(/_/g, ' ');
}

function pctOfTotal(value: number, total: number): string {
  if (total <= 1e-9) return '0,0';
  return ((value / total) * 100).toLocaleString('es-CL', {
    maximumFractionDigits: 1,
  });
}

function buildValuationFullReportHtml(
  tenantName: string,
  data: ValuationFullReportData,
  options: ValuationFullReportRenderOptions,
): string {
  const sections = options.sections ?? ALL_SECTIONS;
  const detailCap = options.detailMaxRows ?? PDF_DETAIL_LINE_CAP;
  const accent = resolveTenantAccent(options.tenantPrimaryColor);
  const logoBlock = buildLogoBlockHtml(
    tenantName,
    options.tenantLogoDataUri,
    'INV',
  );

  const grand = data.inventoryGrandTotal;

  const warehouseRows = data.byWarehouse
    .map(
      (w) => `<tr>
        <td class="l">${escapeHtml(`${w.warehouseCode} — ${w.warehouseName}`)}</td>
        <td class="r">${escapeHtml(formatClp(w.totalValue, 2))}</td>
        <td class="r muted">${escapeHtml(pctOfTotal(w.totalValue, grand))} %</td>
      </tr>`,
    )
    .join('');

  const familyRows = data.byFamily
    .map(
      (f) => `<tr>
        <td class="l">${escapeHtml(f.familyName)}</td>
        <td class="r">${escapeHtml(formatClp(f.totalValue, 2))}</td>
        <td class="r muted">${escapeHtml(pctOfTotal(f.totalValue, grand))} %</td>
      </tr>`,
    )
    .join('');

  const criticalRows = data.criticalItems.length
    ? data.criticalItems
        .map(
          (c) => `<tr>
          <td class="c">${escapeHtml(c.partNumber || '—')}</td>
          <td class="l">${escapeHtml(c.itemName)}</td>
          <td class="l muted">${escapeHtml(c.itemDescription)}</td>
          <td class="l">${escapeHtml(c.familyName)}</td>
          <td class="r">${escapeHtml(String(c.currentStock))}</td>
          <td class="r">${escapeHtml(String(c.minStock))}</td>
          <td class="r" style="color:#b91c1c;font-weight:700;">${escapeHtml(String(c.riskGap))}</td>
        </tr>`,
        )
        .join('')
    : `<tr><td colspan="7" class="c muted">Sin ítems críticos para el corte</td></tr>`;

  const deadRows = data.deadStockItems.length
    ? data.deadStockItems
        .slice(0, 20)
        .map(
          (d) => `<tr>
          <td class="c">${escapeHtml(d.partNumber || '—')}</td>
          <td class="l">${escapeHtml(d.itemName)}</td>
          <td class="l muted">${escapeHtml(d.itemDescription)}</td>
          <td class="l">${escapeHtml(d.familyName)}</td>
          <td class="r">${escapeHtml(d.quantity.toLocaleString('es-CL', { maximumFractionDigits: 2 }))}</td>
          <td class="r">${escapeHtml(formatClp(d.totalValue, 2))}</td>
        </tr>`,
        )
        .join('')
    : `<tr><td colspan="6" class="c muted">Sin stock muerto detectado (sin movimiento ≥ 6 meses)</td></tr>`;

  const detailSlice = sections.itemDetail
    ? data.lines.slice(0, detailCap)
    : [];
  const detailOmitted = sections.itemDetail
    ? data.lines.length - detailSlice.length
    : 0;
  const lineRows = detailSlice
    .map(
      (row) => `<tr>
        <td class="l">${escapeHtml(row.familyName)}</td>
        <td class="l">${escapeHtml(row.subcategoryName || '—')}</td>
        <td class="c">${escapeHtml(row.inventoryCode || '—')}</td>
        <td class="c">${escapeHtml(row.partNumber || '—')}</td>
        <td class="l">${escapeHtml(row.itemName)}</td>
        <td class="l muted">${escapeHtml(row.itemDescription)}</td>
        <td class="r">${escapeHtml(row.totalQty.toLocaleString('es-CL', { maximumFractionDigits: 2 }))}</td>
        <td class="r">${escapeHtml(formatClp(row.cpp, 2))}</td>
        <td class="r">${escapeHtml(formatClp(row.lineValue, 2))}</td>
      </tr>`,
    )
    .join('');
  const detailOmittedNote =
    detailOmitted > 0
      ? `<p class="muted" style="margin:6px 0 0;font-size:8px;">Se omitieron ${detailOmitted} artículos en PDF por límite de tamaño. Descargue el reporte maestro en Excel para el detalle completo (${data.lines.length} líneas).</p>`
      : '';

  const prRows = sections.purchases
    ? (data.purchaseRequisitionExportRows ?? [])
    : [];
  const prTable =
    prRows.length > 0
      ? `<div class="page-break"></div>
    <p class="section-title">Requerimientos y OCs (compras)</p>
    <p class="muted" style="margin:0 0 6px;">SRC activos con detalle de OC y proveedor (compra fragmentada).</p>
    <table class="items">
      <thead><tr><th>SRC</th><th>Estado</th><th>OC / proveedor</th></tr></thead>
      <tbody>${prRows
        .slice(0, 50)
        .map(
          (pr) => `<tr>
          <td class="c">${escapeHtml(pr.correlative)}</td>
          <td class="c">${escapeHtml(labelSrcStatus(pr.status))}</td>
          <td class="l">${escapeHtml(pr.ocVendorDetail?.trim() || 'Sin OC activa')}</td>
        </tr>`,
        )
        .join('')}</tbody>
    </table>`
      : '';

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <title>Valorización inventario</title>
  <style>
    ${buildPdfDocumentBaseCss(accent)}
    ${PDF_DOC_STATUS_CSS}
    .items td, .items th { font-size: 7.5px; padding: 2px 3px; }
    .kpi-row { display: flex; gap: 8px; margin: 8px 0 12px; flex-wrap: wrap; }
    .kpi { flex: 1; min-width: 110px; border: 1px solid var(--border); border-radius: 6px; padding: 8px 10px; background: var(--surface); }
    .kpi .k { font-size: 7px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); margin: 0 0 3px; }
    .kpi .v { font-size: 11px; font-weight: 800; color: var(--accent); margin: 0; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="top">
      <div class="top-doc">
        <div class="doc-brand">
          <div class="logo-corner">${logoBlock}</div>
          <div class="title-block">
            <h1>ESTADO DE SITUACIÓN DE INVENTARIO</h1>
            <p class="doc-status doc-status--caption">
              <span class="doc-status-k">Reporte:</span>
              Valorización maestra CPP — cierre contable
            </p>
          </div>
        </div>
      </div>
      <div class="meta">
        <table class="meta-t">
          <tr><td>Empresa</td><td>${escapeHtml(tenantName)}</td></tr>
          <tr><td>Generado</td><td>${escapeHtml(formatDateTimeEs(data.generatedAt))}</td></tr>
          <tr><td>Valor total</td><td style="font-weight:800;">${escapeHtml(formatClp(data.inventoryGrandTotal, 2))}</td></tr>
          <tr><td>En/bajo mínimo</td><td>${data.itemsBelowMinCount} ítems (≥1 bodega)</td></tr>
        </table>
      </div>
    </div>

    <div class="kpi-row">
      <div class="kpi"><p class="k">Artículos (detalle)</p><p class="v">${sections.itemDetail ? data.lines.length : '—'}</p></div>
      <div class="kpi"><p class="k">Bodegas</p><p class="v">${data.byWarehouse.length}</p></div>
      <div class="kpi"><p class="k">Familias</p><p class="v">${data.byFamily.length}</p></div>
      <div class="kpi"><p class="k">Capital inmovilizado</p><p class="v">${escapeHtml(formatClp(data.immobilizedCapital, 0))}</p></div>
    </div>

    ${
      sections.warehouseSummary
        ? `<p class="section-title">Valor por bodega</p>
    <table class="items">
      <thead><tr><th>Bodega</th><th>Valor</th><th>% total</th></tr></thead>
      <tbody>${warehouseRows || '<tr><td colspan="3" class="c muted">—</td></tr>'}</tbody>
    </table>`
        : ''
    }

    ${
      sections.familySummary
        ? `<p class="section-title">Valorización por familia</p>
    <table class="items">
      <thead><tr><th>Familia</th><th>Valor</th><th>% total</th></tr></thead>
      <tbody>${familyRows || '<tr><td colspan="3" class="c muted">—</td></tr>'}</tbody>
    </table>`
        : ''
    }

    ${
      sections.criticalItems
        ? `<p class="section-title">Ítems críticos — stock bajo mínimo</p>
    <table class="items">
      <thead><tr><th>N° parte</th><th>Nombre</th><th>Descripción</th><th>Familia</th><th>Stock</th><th>Mín.</th><th>Brecha</th></tr></thead>
      <tbody>${criticalRows}</tbody>
    </table>`
        : ''
    }

    ${
      sections.deadStock
        ? `<p class="section-title">Stock muerto (sin mov. ≥ 6 meses) — capital: ${escapeHtml(formatClp(data.immobilizedCapital, 2))}</p>
    <table class="items">
      <thead><tr><th>N° parte</th><th>Nombre</th><th>Descripción</th><th>Familia</th><th>Cant.</th><th>Valor</th></tr></thead>
      <tbody>${deadRows}</tbody>
    </table>`
        : ''
    }

    ${
      sections.itemDetail
        ? `<div class="page-break"></div>
    <p class="section-title">Detalle por artículo (${data.lines.length} líneas)</p>
    ${detailOmittedNote}
    <table class="items">
      <colgroup>
        <col style="width:10%;" />
        <col style="width:9%;" />
        <col style="width:8%;" />
        <col style="width:8%;" />
        <col style="width:14%;" />
        <col style="width:16%;" />
        <col style="width:8%;" />
        <col style="width:9%;" />
        <col style="width:9%;" />
      </colgroup>
      <thead>
        <tr>
          <th>Familia</th><th>Subcat.</th><th>Cód. inv.</th><th>N° parte</th><th>Nombre</th><th>Descripción</th><th>Stock</th><th>CPP</th><th>Valor</th>
        </tr>
      </thead>
      <tbody>${lineRows}</tbody>
    </table>`
        : ''
    }

    ${prTable}

    ${pdfElectronicFootNoteHtml(['Valorización maestra inventario', tenantName])}
  </div>
</body>
</html>`;
}

export async function generateValuationFullReportPdfBuffer(
  tenantName: string,
  data: ValuationFullReportData,
  options: ValuationFullReportRenderOptions = {},
): Promise<Buffer> {
  const html = buildValuationFullReportHtml(tenantName, data, options);
  return renderHtmlToPdfBuffer(html, { landscape: true });
}

export async function generateValuationFullReportXlsxBuffer(
  tenantName: string,
  data: ValuationFullReportData,
  options: ValuationFullReportRenderOptions = {},
): Promise<Buffer> {
  const sections = options.sections ?? ALL_SECTIONS;
  const detailLines =
    sections.itemDetail && options.detailMaxRows != null
      ? data.lines.slice(0, options.detailMaxRows)
      : sections.itemDetail
        ? data.lines
        : [];

  const wb = new ExcelJS.Workbook();
  wb.creator = 'BaseLogic-EAM';
  wb.created = data.generatedAt;

  if (sections.itemDetail && detailLines.length > 0) {
    const ws = wb.addWorksheet('Detalle', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    ws.columns = [
      { header: 'Familia', key: 'family', width: 22 },
      { header: 'Subcategoría', key: 'sub', width: 22 },
      { header: 'Cód. inventario', key: 'inv', width: 14 },
      { header: 'Nº parte', key: 'pn', width: 16 },
    { header: 'Nombre', key: 'name', width: 28 },
    { header: 'Descripción', key: 'desc', width: 32 },
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

    for (const r of detailLines) {
      ws.addRow({
        family: r.familyName,
        sub: r.subcategoryName,
        inv: r.inventoryCode || '—',
      pn: r.partNumber || '—',
      name: r.itemName,
      desc: r.itemDescription,
      qty: r.totalQty,
        cpp: r.cpp,
        val: r.lineValue,
      });
    }
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
  sum.addRow(['Artículos en catálogo', data.lines.length]);
  sum.addRow(['Valor total inventario', data.inventoryGrandTotal]);
  sum.addRow([]);
  if (sections.warehouseSummary) {
    sum.addRow(['Bodega', 'Código', 'Valor', '% total']);
    for (const w of data.byWarehouse) {
      const pct =
        data.inventoryGrandTotal > 1e-9
          ? (w.totalValue / data.inventoryGrandTotal) * 100
          : 0;
      sum.addRow([w.warehouseName, w.warehouseCode, w.totalValue, pct]);
    }
    sum.addRow([]);
  }
  if (sections.familySummary) {
    sum.addRow(['Familia', 'Valor', '% total']);
    for (const f of data.byFamily) {
      const pct =
        data.inventoryGrandTotal > 1e-9
          ? (f.totalValue / data.inventoryGrandTotal) * 100
          : 0;
      sum.addRow([f.familyName, f.totalValue, pct]);
    }
    sum.addRow([]);
  }
  if (sections.deadStock) {
    sum.addRow(['Capital inmovilizado (stock muerto)', data.immobilizedCapital]);
    sum.addRow([]);
  }

  if (sections.criticalItems) {
  const wsCrit = wb.addWorksheet('Críticos', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  wsCrit.columns = [
    { header: 'N° parte', key: 'pn', width: 14 },
    { header: 'Nombre', key: 'name', width: 28 },
    { header: 'Descripción', key: 'desc', width: 32 },
    { header: 'Familia', key: 'fam', width: 22 },
    { header: 'Stock', key: 'stk', width: 10 },
    { header: 'Mínimo', key: 'min', width: 10 },
    { header: 'Brecha', key: 'gap', width: 10 },
  ];
  const hc = wsCrit.getRow(1);
  hc.font = { bold: true };
  hc.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFFEE2E2' },
  };
  for (const c of data.criticalItems) {
    wsCrit.addRow({
      pn: c.partNumber || '—',
      name: c.itemName,
      desc: c.itemDescription,
      fam: c.familyName,
      stk: c.currentStock,
      min: c.minStock,
      gap: c.riskGap,
    });
  }
  }

  if (sections.deadStock) {
  const wsDead = wb.addWorksheet('Stock muerto', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  wsDead.columns = [
    { header: 'N° parte', key: 'pn', width: 14 },
    { header: 'Nombre', key: 'name', width: 28 },
    { header: 'Descripción', key: 'desc', width: 32 },
    { header: 'Familia', key: 'fam', width: 22 },
    { header: 'Cantidad', key: 'qty', width: 12 },
    { header: 'Valor', key: 'val', width: 14 },
  ];
  const hd = wsDead.getRow(1);
  hd.font = { bold: true };
  hd.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFFEF3C7' },
  };
  for (const d of data.deadStockItems) {
    wsDead.addRow({
      pn: d.partNumber || '—',
      name: d.itemName,
      desc: d.itemDescription,
      fam: d.familyName,
      qty: d.quantity,
      val: d.totalValue,
    });
  }
  }

  const prRows = sections.purchases
    ? (data.purchaseRequisitionExportRows ?? [])
    : [];
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
        st: labelSrcStatus(pr.status),
        detail: pr.ocVendorDetail || '—',
      });
    }
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
