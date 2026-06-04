import {
  buildLogoBlockHtml,
  buildPdfDocumentBaseCss,
  escapeHtml,
  formatDateTimeEs,
  pdfElectronicFootNoteHtml,
  PDF_DOC_STATUS_CSS,
  renderHtmlToPdfBuffer,
  resolveTenantAccent,
} from '../../common/pdf/pdf-html-shared';

export type PhysicalCountSheetRow = {
  inventoryCode: string;
  partNumber: string;
  /** Nombre comercial / corto del catálogo (`inventory_items.name`). */
  itemName: string;
  /** Descripción extendida del catálogo (`inventory_items.description`). */
  description: string;
  location: string;
};

export type PhysicalCountSheetPdfOptions = {
  tenantName?: string | null;
  tenantLogoDataUri?: string | null;
  tenantPrimaryColor?: string | null;
};

function sortRowsByLocation(
  rows: PhysicalCountSheetRow[],
): PhysicalCountSheetRow[] {
  return [...rows].sort((a, b) => {
    const ka = (a.location ?? '').trim() || '\uffff';
    const kb = (b.location ?? '').trim() || '\uffff';
    const c = ka.localeCompare(kb, 'es', { sensitivity: 'base' });
    if (c !== 0) return c;
    const pn = a.partNumber.localeCompare(b.partNumber, 'es', {
      sensitivity: 'base',
    });
    if (pn !== 0) return pn;
    return a.itemName.localeCompare(b.itemName, 'es', { sensitivity: 'base' });
  });
}

function buildPhysicalCountSheetHtml(
  data: {
    warehouseCode: string;
    warehouseName: string;
    generatedAt: Date;
    rows: PhysicalCountSheetRow[];
  },
  options: PhysicalCountSheetPdfOptions,
): string {
  const accent = resolveTenantAccent(options.tenantPrimaryColor);
  const sorted = sortRowsByLocation(data.rows);
  const whTitle = `${data.warehouseCode} — ${data.warehouseName}`.trim();
  const logoBlock = buildLogoBlockHtml(
    options.tenantName,
    options.tenantLogoDataUri,
    'CNT',
  );

  const rowsHtml = sorted
    .map(
      (r) => `<tr>
        <td class="c">${escapeHtml(r.inventoryCode || '—')}</td>
        <td class="c">${escapeHtml(r.partNumber || '—')}</td>
        <td class="l">${escapeHtml((r.itemName ?? '').trim() || '—')}</td>
        <td class="l">${escapeHtml((r.description ?? '').trim() || '—')}</td>
        <td class="c">${escapeHtml((r.location ?? '').trim() || '—')}</td>
        <td class="qty-line"></td>
      </tr>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <title>Conteo físico ${escapeHtml(data.warehouseCode)}</title>
  <style>
    ${buildPdfDocumentBaseCss(accent)}
    ${PDF_DOC_STATUS_CSS}
    .items tbody tr { min-height: 22px; }
    .sig-block {
      margin-top: 14px;
      border: 1px solid #0f172a;
      padding: 10px 12px;
      border-radius: 3px;
      font-size: 9px;
      line-height: 1.45;
      page-break-inside: avoid;
    }
    .sig-line {
      margin-top: 28px;
      border-bottom: 1px solid #334155;
      max-width: 340px;
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="top">
      <div class="top-doc">
        <div class="doc-brand">
          <div class="logo-corner">${logoBlock}</div>
          <div class="title-block">
            <h1>HOJA DE CONTEO FÍSICO (CIEGA)</h1>
            <p class="doc-status doc-status--caption">
              <span class="doc-status-k">Uso:</span>
              Registro en bodega sin saldo de sistema
            </p>
          </div>
        </div>
      </div>
      <div class="meta">
        <table class="meta-t">
          <tr>
            <td>Bodega</td>
            <td style="font-weight:800;">${escapeHtml(whTitle)}</td>
          </tr>
          <tr>
            <td>Emisión</td>
            <td>${escapeHtml(formatDateTimeEs(data.generatedAt))}</td>
          </tr>
          <tr>
            <td>Líneas</td>
            <td>${sorted.length}</td>
          </tr>
          ${
            options.tenantName?.trim()
              ? `<tr><td>Empresa</td><td>${escapeHtml(options.tenantName.trim())}</td></tr>`
              : ''
          }
        </table>
      </div>
    </div>

    <div class="dest">
      <strong>Instrucción</strong><br/>
      Registre la cantidad física contada en cada línea. Este documento no muestra el saldo del sistema ERP.
    </div>

    <table class="items">
      <colgroup>
        <col style="width:11%;" />
        <col style="width:11%;" />
        <col style="width:22%;" />
        <col style="width:26%;" />
        <col style="width:12%;" />
        <col style="width:18%;" />
      </colgroup>
      <thead>
        <tr>
          <th>Cód. inventario</th>
          <th>N° parte</th>
          <th>Nombre</th>
          <th>Descripción</th>
          <th>Ubicación</th>
          <th>Cantidad real</th>
        </tr>
      </thead>
      <tbody>
        ${
          rowsHtml ||
          '<tr><td colspan="6" class="c muted">Sin artículos en esta bodega</td></tr>'
        }
      </tbody>
    </table>

    <div class="sig-block">
      <strong>Cierre de conteo</strong><br/>
      Declaro que las cantidades anotadas corresponden al conteo físico realizado en bodega.
      <div class="sig-line"></div>
      <span class="muted">Nombre y firma del responsable del conteo</span><br/>
      <span style="margin-top:8px;display:inline-block;">Fecha: ____________________</span>
    </div>

    ${pdfElectronicFootNoteHtml([`Conteo físico · ${whTitle}`])}
  </div>
</body>
</html>`;
}

/**
 * Hoja de conteo físico a ciegas: sin columna de stock sistema.
 */
export async function generatePhysicalCountSheetPdfBuffer(
  data: {
    warehouseCode: string;
    warehouseName: string;
    generatedAt: Date;
    rows: PhysicalCountSheetRow[];
  },
  options: PhysicalCountSheetPdfOptions = {},
): Promise<Buffer> {
  const html = buildPhysicalCountSheetHtml(data, options);
  return renderHtmlToPdfBuffer(html, { landscape: true });
}
