import ExcelJS from 'exceljs';
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

export type ValuationSummaryReportData = {
  generatedAt: Date;
  grandTotal: number;
  byFamily: Array<{ familyName: string; totalValue: number }>;
};

export type ValuationSummaryPdfOptions = {
  tenantLogoDataUri?: string | null;
  tenantPrimaryColor?: string | null;
};

function buildValuationSummaryHtml(
  tenantName: string,
  data: ValuationSummaryReportData,
  options: ValuationSummaryPdfOptions,
): string {
  const accent = resolveTenantAccent(options.tenantPrimaryColor);
  const logoBlock = buildLogoBlockHtml(
    tenantName,
    options.tenantLogoDataUri,
    'INV',
  );
  const grand = data.grandTotal;
  const familyRows = data.byFamily
    .map((f) => {
      const pct =
        grand > 1e-9 ? ((f.totalValue / grand) * 100).toFixed(1) : '0.0';
      return `<tr>
        <td class="l">${escapeHtml(f.familyName)}</td>
        <td class="r">${escapeHtml(formatClp(f.totalValue, 0))}</td>
        <td class="r muted">${escapeHtml(pct)} %</td>
      </tr>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <title>Valorización por familia</title>
  <style>
    ${buildPdfDocumentBaseCss(accent)}
    ${PDF_DOC_STATUS_CSS}
    .items td, .items th { font-size: 9px; padding: 4px 6px; }
    .kpi-row { display: flex; gap: 10px; margin: 10px 0 14px; flex-wrap: wrap; }
    .kpi { flex: 1; min-width: 140px; border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; background: var(--surface); }
    .kpi .k { font-size: 8px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); margin: 0 0 4px; }
    .kpi .v { font-size: 14px; font-weight: 800; color: var(--accent); margin: 0; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="top">
      <div class="top-doc">
        <div class="doc-brand">
          <div class="logo-corner">${logoBlock}</div>
          <div class="title-block">
            <h1>VALORIZACIÓN DE INVENTARIO</h1>
            <p class="doc-status doc-status--caption">
              <span class="doc-status-k">Alcance:</span>
              Resumen ejecutivo por familia (nivel 1)
            </p>
          </div>
        </div>
      </div>
      <div class="meta">
        <table class="meta-t">
          <tr><td>Empresa</td><td>${escapeHtml(tenantName)}</td></tr>
          <tr><td>Generado</td><td>${escapeHtml(formatDateTimeEs(data.generatedAt))}</td></tr>
          <tr><td>Método</td><td>Σ (cantidad × CPP) en todas las bodegas</td></tr>
        </table>
      </div>
    </div>

    <div class="kpi-row">
      <div class="kpi">
        <p class="k">Valor total inventario</p>
        <p class="v">${escapeHtml(formatClp(data.grandTotal, 0))}</p>
      </div>
      <div class="kpi">
        <p class="k">Familias con stock valorizado</p>
        <p class="v">${data.byFamily.length}</p>
      </div>
    </div>

    <p class="section-title">Distribución por familia</p>
    <table class="items">
      <thead>
        <tr><th>Familia (nivel 1)</th><th>Valor (CLP)</th><th>% del total</th></tr>
      </thead>
      <tbody>
        ${familyRows || '<tr><td colspan="3" class="c muted">Sin datos de valorización</td></tr>'}
        <tr style="font-weight:800;border-top:2px solid var(--border);">
          <td class="l">TOTAL EMPRESA</td>
          <td class="r">${escapeHtml(formatClp(data.grandTotal, 0))}</td>
          <td class="r">100 %</td>
        </tr>
      </tbody>
    </table>

    <p class="muted" style="margin-top:12px;font-size:8px;">
      Para detalle por artículo, bodega, ítems críticos y compras (SRC/OC), use el reporte maestro desde el mismo panel.
    </p>

    ${pdfElectronicFootNoteHtml(['Valorización inventario — resumen', tenantName])}
  </div>
</body>
</html>`;
}

export async function generateValuationSummaryPdfBuffer(
  tenantName: string,
  data: ValuationSummaryReportData,
  options: ValuationSummaryPdfOptions = {},
): Promise<Buffer> {
  const html = buildValuationSummaryHtml(tenantName, data, options);
  return renderHtmlToPdfBuffer(html);
}

export async function generateValuationSummaryXlsxBuffer(
  tenantName: string,
  data: ValuationSummaryReportData,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'BaseLogic-EAM';
  wb.created = data.generatedAt;

  const ws = wb.addWorksheet('Por familia', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  ws.columns = [
    { header: 'Familia (nivel 1)', key: 'family', width: 32 },
    { header: 'Valor (CLP)', key: 'val', width: 18 },
    { header: '% del total', key: 'pct', width: 12 },
  ];
  const h = ws.getRow(1);
  h.font = { bold: true };
  h.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE8E8E8' },
  };

  const grand = data.grandTotal;
  for (const f of data.byFamily) {
    const pct = grand > 1e-9 ? (f.totalValue / grand) * 100 : 0;
    ws.addRow({
      family: f.familyName,
      val: f.totalValue,
      pct: Math.round(pct * 10) / 10,
    });
  }
  ws.addRow({
    family: 'TOTAL EMPRESA',
    val: data.grandTotal,
    pct: 100,
  });
  const totalRow = ws.lastRow;
  if (totalRow) totalRow.font = { bold: true };

  const meta = wb.addWorksheet('Metadatos');
  meta.addRow(['Empresa', tenantName]);
  meta.addRow([
    'Generado',
    data.generatedAt.toLocaleString('es-CL', {
      dateStyle: 'short',
      timeStyle: 'short',
    }),
  ]);
  meta.addRow(['Valor total', data.grandTotal]);
  meta.addRow(['Familias', data.byFamily.length]);

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
