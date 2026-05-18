import { chromium } from 'playwright';

/**
 * PDF ejecutivo de compras (analytics) — HTML + Chromium.
 * Patrón: `docs/agentes/pdf-html-playwright-plantilla-base.md`.
 */

/** Subconjunto del resultado de `PurchasesAnalyticsService.getDashboard`. */
export type PurchasesAnalyticsDashboardPdfData = {
  filters: { from: string; to: string; contractId: string | null };
  kpis: {
    totalApprovedSpend: number;
    pendingSignaturePurchaseOrders: number;
    invoiceDiscrepancyRate: number;
    invoiceDiscrepancyCount: number;
    invoiceTotalForRate: number;
    multiproviderAdjudicationSavings?: number;
  };
  requisitionPipeline?: Record<string, number>;
  partialRequisitionPurchaseProgress?: {
    partialRequisitionCount: number;
    lineItemsTotal: number;
    lineItemsWithActivePo: number;
  };
  requisitionPurchaseRows?: Array<{
    correlative: string;
    status: string;
    ocLines: string[];
  }>;
  imputationSpend: { general: number; equipment: number; workOrder: number };
  monthlySpend: Array<{ month: string; total: number }>;
  topVendors: Array<{
    vendorId: string;
    vendorName: string;
    vendorCode: string;
    purchaseVolume: number;
    avgLeadTimeDays: number | null;
  }>;
  overpaymentPrevention: number;
};

export type PurchasesAnalyticsPdfOptions = {
  tenantLogoDataUri?: string | null;
  /** Color de marca (#RRGGBB) para acentos; fallback cyan TPM. */
  tenantPrimaryColor?: string | null;
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatClp(n: number): string {
  try {
    return `$ ${n.toLocaleString('es-CL', { maximumFractionDigits: 0 })}`;
  } catch {
    return `$ ${n}`;
  }
}

function formatPct(n: number): string {
  return `${(n * 100).toLocaleString('es-CL', { maximumFractionDigits: 1 })} %`;
}

function formatLongRange(from: Date, to: Date): string {
  try {
    const a = from.toLocaleDateString('es-CL', { timeZone: 'UTC' });
    const b = to.toLocaleDateString('es-CL', { timeZone: 'UTC' });
    return `${a} — ${b}`;
  } catch {
    return `${from.toISOString().slice(0, 10)} — ${to.toISOString().slice(0, 10)}`;
  }
}

/** Lead time medio ponderado por volumen de compra (top proveedores). */
export function weightedAvgLeadTimeDays(
  vendors: PurchasesAnalyticsDashboardPdfData['topVendors'],
): number | null {
  let num = 0;
  let den = 0;
  for (const v of vendors) {
    if (v.avgLeadTimeDays != null && v.purchaseVolume > 0) {
      num += v.avgLeadTimeDays * v.purchaseVolume;
      den += v.purchaseVolume;
    }
  }
  if (den <= 0) return null;
  return Math.round((num / den) * 10) / 10;
}

function barFillPct(pct: number): number {
  return Math.max(0, Math.min(100, pct));
}

function buildPurchasesAnalyticsHtml(
  tenantName: string,
  contractLabel: string,
  periodFrom: Date,
  periodTo: Date,
  data: PurchasesAnalyticsDashboardPdfData,
  options: PurchasesAnalyticsPdfOptions,
): string {
  const accent =
    options.tenantPrimaryColor?.trim() &&
    /^#[0-9A-Fa-f]{6}$/.test(options.tenantPrimaryColor.trim())
      ? options.tenantPrimaryColor.trim()
      : '#0891b2';

  const logoBlock = options.tenantLogoDataUri
    ? `<img class="logo" src="${options.tenantLogoDataUri}" alt="" />`
    : `<div class="logo-ph">${escapeHtml(tenantName.slice(0, 3).toUpperCase() || 'BL')}</div>`;

  const leadAvg = weightedAvgLeadTimeDays(data.topVendors);

  const kpiSpend = escapeHtml(formatClp(data.kpis.totalApprovedSpend));
  const kpiPrev = escapeHtml(formatClp(data.overpaymentPrevention));
  const kpiLead =
    leadAvg != null ? escapeHtml(`${leadAvg} días`) : escapeHtml('—');

  const mpSave = data.kpis.multiproviderAdjudicationSavings ?? 0;
  const mpLine = escapeHtml(formatClp(mpSave));

  const part = data.partialRequisitionPurchaseProgress;
  const partialHtml =
    part && part.lineItemsTotal > 0
      ? `<p class="callout callout-info"><strong>Compras parciales:</strong> ${escapeHtml(String(part.lineItemsWithActivePo))} / ${escapeHtml(String(part.lineItemsTotal))} líneas de ítem con OC activa (${escapeHtml(String(part.partialRequisitionCount))} SRC en estado compra parcial).</p>`
      : '';

  const rowsReq = data.requisitionPurchaseRows ?? [];
  const reqRowsHtml =
    rowsReq.length > 0
      ? rowsReq
          .slice(0, 40)
          .map((r) => {
            const ocText =
              r.ocLines.length > 0
                ? escapeHtml(r.ocLines.join(' · '))
                : escapeHtml('Sin OC activa');
            return `<tr>
            <td class="c">${escapeHtml(r.correlative)}</td>
            <td class="c">${escapeHtml(r.status)}</td>
            <td class="l">${ocText}</td>
          </tr>`;
          })
          .join('')
      : `<tr><td colspan="3" class="c muted">Sin filas en el período seleccionado</td></tr>`;

  const imp = data.imputationSpend;
  const impSum = imp.general + imp.equipment + imp.workOrder;
  const impSumSafe = impSum > 0 ? impSum : 1;
  const rowsImp: [string, number][] = [
    ['Gasto general', imp.general],
    ['Por equipo', imp.equipment],
    ['Por orden de trabajo', imp.workOrder],
  ];
  const impHtml = rowsImp
    .map(([label, amt]) => {
      const pct = (amt / impSumSafe) * 100;
      const w = barFillPct(pct);
      return `<tr>
        <td class="lbl">${escapeHtml(label)}</td>
        <td class="r">${escapeHtml(formatClp(amt))}</td>
        <td class="bar-cell">
          <div class="bar-track" aria-hidden="true"><div class="bar-fill" style="width:${w}%;"></div></div>
          <span class="bar-pct">${escapeHtml(`${pct.toFixed(0)} %`)}</span>
        </td>
      </tr>`;
    })
    .join('');

  const volSum =
    data.topVendors.reduce((s, v) => s + v.purchaseVolume, 0) || 1;
  const vendorRows = data.topVendors
    .map((v) => {
      const share = volSum > 0 ? (v.purchaseVolume / volSum) * 100 : 0;
      const w = barFillPct(share);
      return `<tr>
        <td class="l">${escapeHtml(`${v.vendorCode} — ${v.vendorName}`)}</td>
        <td class="r">${escapeHtml(formatClp(v.purchaseVolume))}</td>
        <td class="r">${escapeHtml(`${share.toFixed(1)} %`)}</td>
        <td class="bar-cell">
          <div class="bar-track"><div class="bar-fill" style="width:${w}%;"></div></div>
        </td>
      </tr>`;
    })
    .join('');

  const leadDetailRows = data.topVendors
    .map((v) => {
      const lt =
        v.avgLeadTimeDays != null
          ? `${v.avgLeadTimeDays} días`
          : 'Sin recepciones en período';
      return `<tr><td colspan="2">${escapeHtml(`${v.vendorName} (${v.vendorCode}): ${lt}`)}</td></tr>`;
    })
    .join('');

  const discNote = escapeHtml(
    `En el período se registraron ${data.kpis.invoiceDiscrepancyCount} factura(s) con discrepancia sobre ${data.kpis.invoiceTotalForRate} validada(s) para tasa ${formatPct(data.kpis.invoiceDiscrepancyRate)}.`,
  );
  const prevNote = escapeHtml(
    `El monto acumulado asociado a prevención de sobrepagos (correcciones tras discrepancia) es ${formatClp(data.overpaymentPrevention)}.`,
  );
  const policyNote = escapeHtml(
    'Las discrepancias indican diferencias entre OC, recepción en bodega y monto facturado, según la política de margen configurada en Compras.',
  );

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <title>Reporte de compras</title>
  <style>
    @page { size: A4; margin: 9mm; }
    :root { --accent: ${accent}; }
    * { box-sizing: border-box; }
    body {
      font-family: system-ui, "Segoe UI", Roboto, Arial, sans-serif;
      font-size: 9.5px;
      color: #111827;
      margin: 0;
      padding: 0;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .wrap { max-width: 190mm; margin: 0 auto; }
    .top {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 10px;
      margin-bottom: 8px;
    }
    .top-doc {
      flex: 1 1 auto;
      min-width: 0;
      max-width: 54%;
    }
    .doc-brand {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 12px;
    }
    .title-block { width: 100%; min-width: 0; padding-top: 6px; }
    .title-block h1 {
      margin: 0;
      font-size: 13px;
      font-weight: 800;
      letter-spacing: 0.02em;
      color: #0f172a;
      border-left: 4px solid var(--accent);
      padding-left: 8px;
    }
    .doc-status {
      margin: 10px 0 0;
      display: inline-block;
      max-width: 100%;
      padding: 5px 10px 6px;
      border-radius: 5px;
      border: 1px solid transparent;
      font-size: 10.5px;
      font-weight: 700;
      line-height: 1.4;
      letter-spacing: 0.01em;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .doc-status-k {
      font-weight: 800;
      font-size: 9px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      margin-right: 6px;
      opacity: 0.9;
    }
    .doc-status--caption {
      background: #f0f9ff;
      color: #0c4a6e;
      border-color: #7dd3fc;
      font-weight: 600;
      font-size: 10px;
    }
    .doc-status--caption .doc-status-k {
      color: #075985;
    }
    .logo-corner {
      flex: 0 0 auto;
      text-align: left;
    }
    .logo-corner .logo {
      max-height: 50px;
      max-width: 172px;
      width: auto;
      height: auto;
      object-fit: contain;
      display: block;
    }
    .logo-corner .logo-ph {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 36px;
      min-width: 60px;
      max-width: 145px;
      border: 1px dashed #94a3b8;
      color: #64748b;
      font-weight: 700;
      font-size: 10px;
      border-radius: 4px;
    }
    .meta { flex: 0 0 36%; width: 36%; min-width: 0; max-width: 36%; }
    table.meta-t { width: 100%; border-collapse: collapse; }
    table.meta-t td {
      border: 1px solid #0f172a;
      padding: 3px 5px;
      vertical-align: middle;
    }
    table.meta-t td:first-child {
      font-weight: 700;
      color: #0f172a;
      width: 56px;
    }
    .muted { color: #475569; font-size: 8.5px; }
    .dest {
      border: 1px solid #64748b;
      background: #f1f5f9;
      padding: 6px 8px;
      border-radius: 3px;
      font-size: 8.5px;
      line-height: 1.4;
      margin-bottom: 8px;
    }
    .section-title {
      margin: 10px 0 5px;
      font-size: 11px;
      font-weight: 800;
      color: #0f172a;
      border-bottom: 2px solid var(--accent);
      padding-bottom: 2px;
    }
    .kpi-row { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
    .kpi-row td {
      border: 1px solid #0f172a;
      width: 33.33%;
      vertical-align: top;
      padding: 6px 8px;
    }
    .kpi-row .kt {
      font-size: 8px;
      font-weight: 700;
      color: #475569;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .kpi-row .kv { font-size: 11px; font-weight: 800; color: #0f172a; margin-top: 4px; }
    .callout {
      border: 1px solid #0f172a;
      padding: 5px 7px;
      margin: 0 0 8px;
      font-size: 9px;
      line-height: 1.35;
    }
    .callout-teal {
      background: #ecfdf5;
      border-color: #0f766e;
      color: #064e3b;
    }
    .callout-info {
      background: #f0f9ff;
      border-color: #0c4a6e;
      color: #0c4a6e;
    }
    .grid2 { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
    .grid2 td {
      border: 1px solid #0f172a;
      padding: 4px 6px;
      vertical-align: middle;
    }
    .grid2 td.lbl {
      font-weight: 700;
      color: #0f172a;
      width: 34%;
    }
    .grid2 td.r { text-align: right; white-space: nowrap; }
    .grid2 td.c { text-align: center; }
    .grid2 td.l { text-align: left; word-wrap: break-word; overflow-wrap: anywhere; }
    .items {
      width: 100%;
      table-layout: fixed;
      border-collapse: collapse;
      margin-bottom: 8px;
    }
    .items thead { display: table-header-group; }
    .items th {
      background: #e2e8f0;
      font-weight: 700;
      text-align: center;
      border: 1px solid #0f172a;
      padding: 4px 3px;
      font-size: 8.5px;
    }
    .items td {
      border: 1px solid #0f172a;
      padding: 3px 4px;
      vertical-align: top;
      font-size: 8.5px;
    }
    .bar-cell { vertical-align: middle; }
    .bar-track {
      height: 9px;
      background: #e2e8f0;
      border: 1px solid #0f172a;
      border-radius: 2px;
      overflow: hidden;
      margin-top: 2px;
    }
    .bar-fill {
      height: 100%;
      background: var(--accent);
      opacity: 0.85;
    }
    .bar-pct { font-size: 7.5px; color: #64748b; margin-left: 4px; }
    .page-break { break-before: page; page-break-before: always; }
    .foot-note {
      margin-top: 12px;
      font-size: 7.5px;
      color: #64748b;
      line-height: 1.35;
      text-align: center;
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
            <h1>REPORTE EJECUTIVO DE GESTIÓN DE COMPRAS</h1>
            <p class="doc-status doc-status--caption"><span class="doc-status-k">Vista:</span> ${escapeHtml('Analítica consolidada del período')}</p>
          </div>
        </div>
      </div>
      <div class="meta">
        <table class="meta-t">
          <tr>
            <td>Organización</td>
            <td>${escapeHtml(tenantName)}</td>
          </tr>
          <tr>
            <td>Período</td>
            <td>${escapeHtml(formatLongRange(periodFrom, periodTo))}</td>
          </tr>
          <tr>
            <td>Alcance</td>
            <td>${escapeHtml(contractLabel)}</td>
          </tr>
        </table>
      </div>
    </div>

    <div class="dest">
      <strong>Contexto</strong><br/>
      Resumen de KPIs, imputación de gasto, concentración por proveedor y notas de control (3-way match / discrepancias)
      según el alcance de contrato y fechas indicados en la cabecera.
    </div>

    <p class="section-title">Resumen ejecutivo</p>
    <table class="kpi-row">
      <tr>
        <td>
          <div class="kt">Gasto total aprobado (OC)</div>
          <div class="kv">${kpiSpend}</div>
        </td>
        <td>
          <div class="kt">Prevención de sobrepagos</div>
          <div class="kv">${kpiPrev}</div>
        </td>
        <td>
          <div class="kt">Lead time promedio (ponderado)</div>
          <div class="kv">${kpiLead}</div>
        </td>
      </tr>
    </table>

    <p class="callout callout-teal">
      <strong>Ahorro por adjudicación multiproveedor</strong> (SRC actualizados en el período): ${mpLine}.<br/>
      <span class="muted">Estimación: por cada ítem adjudicado se compara el precio unitario máximo cotizado frente al adjudicado, multiplicado por la cantidad solicitada.</span>
    </p>
    ${partialHtml}

    <p class="section-title">Requerimientos — OC y proveedor</p>
    <table class="items">
      <colgroup>
        <col style="width:18%;" />
        <col style="width:22%;" />
        <col style="width:60%;" />
      </colgroup>
      <thead>
        <tr>
          <th>SRC</th>
          <th>Estado</th>
          <th>OC / proveedor (referencia)</th>
        </tr>
      </thead>
      <tbody>${reqRowsHtml}</tbody>
    </table>

    <p class="section-title">Distribución del gasto por imputación</p>
    <table class="grid2">
      ${impHtml}
    </table>

    <p class="section-title">Top proveedores por volumen</p>
    <table class="items">
      <colgroup>
        <col style="width:44%;" />
        <col style="width:20%;" />
        <col style="width:14%;" />
        <col style="width:22%;" />
      </colgroup>
      <thead>
        <tr>
          <th>Proveedor</th>
          <th>Volumen</th>
          <th>% s/ top</th>
          <th></th>
        </tr>
      </thead>
      <tbody>${vendorRows}</tbody>
    </table>

    <div class="page-break"></div>

    <p class="section-title">Detalle de eficiencia — lead time por proveedor</p>
    <table class="grid2">
      ${leadDetailRows || `<tr><td class="muted">Sin datos de proveedores en el período</td></tr>`}
    </table>

    <p class="section-title">Notas de control — facturación y 3-way match</p>
    <p style="font-size:9px;line-height:1.45;color:#334155;">${discNote}</p>
    <p style="font-size:9px;line-height:1.45;color:#334155;">${prevNote}</p>
    <p class="muted" style="font-size:8px;">${policyNote}</p>

    <p class="foot-note">
      Documento generado ${escapeHtml(new Date().toLocaleString('es-CL'))} · ${escapeHtml(tenantName)} · TPM / BaseLogic
    </p>
  </div>
</body>
</html>`;
}

export async function generatePurchasesAnalyticsReportPdfBuffer(
  tenantName: string,
  contractLabel: string,
  periodFrom: Date,
  periodTo: Date,
  data: PurchasesAnalyticsDashboardPdfData,
  options: PurchasesAnalyticsPdfOptions = {},
): Promise<Buffer> {
  const html = buildPurchasesAnalyticsHtml(
    tenantName,
    contractLabel,
    periodFrom,
    periodTo,
    data,
    options,
  );
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-dev-shm-usage', '--no-sandbox'],
    executablePath:
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?.trim() || undefined,
  });
  try {
    const page = await browser.newPage();
    try {
      await page.setContent(html, { waitUntil: 'load' });
      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '7mm', bottom: '7mm', left: '9mm', right: '9mm' },
      });
      return Buffer.from(pdf);
    } finally {
      await page.close();
    }
  } finally {
    await browser.close();
  }
}
