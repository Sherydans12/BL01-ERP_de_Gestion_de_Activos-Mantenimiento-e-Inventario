import {
  buildLogoBlockHtml,
  buildPdfDocumentBaseCss,
  escapeHtml,
  formatClp,
  pdfElectronicFootNoteHtml,
  PDF_DOC_STATUS_CSS,
  renderHtmlToPdfBuffer,
  resolveTenantAccent,
} from '../../common/pdf/pdf-html-shared';

/** Datos mínimos del tablero para el PDF (evita import circular con el servicio). */
export type WorkOrderAnalyticsDashboardPdfSlice = {
  kpis: {
    fleetAvailabilityPct: number | null;
    mttrHours: number | null;
    mtbfHours: number | null;
    downtimeImpactHoursSi: number;
    correctiveOtCountForMttr: number;
    unplannedFailureIntervalsForMtbf: number;
  };
  paretoSystems: Array<{ label: string; otCount: number }>;
  programmedSplit: {
    programmed: number;
    notProgrammed: number;
    unknown: number;
  };
};

export type WorkOrderManagementMonthlyPdfInput = {
  tenantName: string;
  year: number;
  month: number;
  contractLabel: string;
  dashboard: WorkOrderAnalyticsDashboardPdfSlice;
  availabilityReferenceLines?: Array<{
    label: string;
    availabilityPct: string;
  }>;
  totalAssetCostWo: number;
  totalLaborHours: number;
  laborRatePerHour: number;
  laborCostEstimate: number;
  totalMaintenanceEstimate: number;
};

export type WorkOrderManagementMonthlyPdfOptions = {
  tenantLogoDataUri?: string | null;
  tenantPrimaryColor?: string | null;
};

function formatPct(n: number | null): string {
  if (n == null || Number.isNaN(n)) return '—';
  return `${n.toFixed(1)} %`;
}

function formatHours(n: number | null): string {
  if (n == null || Number.isNaN(n)) return '—';
  return `${n.toFixed(1)} h`;
}

function buildWorkOrderManagementMonthlyHtml(
  payload: WorkOrderManagementMonthlyPdfInput,
  options: WorkOrderManagementMonthlyPdfOptions,
): string {
  const {
    tenantName,
    year,
    month,
    contractLabel,
    dashboard,
    availabilityReferenceLines,
    totalAssetCostWo,
    totalLaborHours,
    laborRatePerHour,
    laborCostEstimate,
    totalMaintenanceEstimate,
  } = payload;

  const accent = resolveTenantAccent(options.tenantPrimaryColor);
  const monthLabel = new Date(year, month - 1, 1).toLocaleDateString('es-CL', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const logoBlock = buildLogoBlockHtml(
    tenantName,
    options.tenantLogoDataUri,
    'MNT',
  );
  const k = dashboard.kpis;

  const refRows = (availabilityReferenceLines ?? [])
    .map(
      (row) => `<tr>
        <td class="l">${escapeHtml(row.label)}</td>
        <td class="r">${escapeHtml(row.availabilityPct)}</td>
      </tr>`,
    )
    .join('');

  const paretoRows = [...dashboard.paretoSystems]
    .filter((p) => p.otCount > 0)
    .slice(0, 12)
    .map(
      (row) => `<tr>
        <td class="l">${escapeHtml(row.label)}</td>
        <td class="r">${row.otCount}</td>
      </tr>`,
    )
    .join('');

  const ps = dashboard.programmedSplit;

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <title>Resumen gestión mantenimiento ${monthLabel}</title>
  <style>
    ${buildPdfDocumentBaseCss(accent)}
    ${PDF_DOC_STATUS_CSS}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="top">
      <div class="top-doc">
        <div class="doc-brand">
          <div class="logo-corner">${logoBlock}</div>
          <div class="title-block">
            <h1>RESUMEN DE GESTIÓN MENSUAL</h1>
            <p class="doc-status doc-status--caption">
              <span class="doc-status-k">Área:</span>
              Mantenimiento y confiabilidad
            </p>
          </div>
        </div>
      </div>
      <div class="meta">
        <table class="meta-t">
          <tr>
            <td>Período</td>
            <td style="font-weight:700;">${escapeHtml(monthLabel)}</td>
          </tr>
          <tr>
            <td>Alcance</td>
            <td>${escapeHtml(contractLabel)}</td>
          </tr>
          <tr>
            <td>Organización</td>
            <td>${escapeHtml(tenantName)}</td>
          </tr>
        </table>
      </div>
    </div>

    <p class="section-title">Indicadores de confiabilidad</p>
    <div class="kpi-row">
      <div class="kpi-box">
        <div class="kpi-t">Disponibilidad física (flota)</div>
        <div class="kpi-v">${escapeHtml(formatPct(k.fleetAvailabilityPct))}</div>
      </div>
      <div class="kpi-box">
        <div class="kpi-t">MTTR (correctivas)</div>
        <div class="kpi-v">${escapeHtml(formatHours(k.mttrHours))}</div>
      </div>
      <div class="kpi-box">
        <div class="kpi-t">MTBF (entre fallas NP)</div>
        <div class="kpi-v">${escapeHtml(formatHours(k.mtbfHours))}</div>
      </div>
    </div>
    <p class="muted" style="margin:0 0 10px;">
      Detención con impacto en disponibilidad (mes): ${escapeHtml(formatHours(k.downtimeImpactHoursSi))} ·
      OT correctivas en MTTR: ${k.correctiveOtCountForMttr} ·
      Intervalos MTBF: ${k.unplannedFailureIntervalsForMtbf}
    </p>

    ${
      refRows
        ? `<p class="section-title">Referencia — disponibilidad por equipo (menor PA primero)</p>
    <table class="items">
      <thead><tr><th>Equipo</th><th>PA período</th></tr></thead>
      <tbody>${refRows}</tbody>
    </table>`
        : ''
    }

    <p class="section-title">Costos de mantenimiento (estimado)</p>
    <table class="grid2">
      <tr>
        <td class="lbl">Repuestos y fluidos (asset cost OT)</td>
        <td class="r">${escapeHtml(formatClp(totalAssetCostWo))}</td>
      </tr>
      <tr>
        <td class="lbl">Mano de obra</td>
        <td class="r">${escapeHtml(formatClp(laborCostEstimate))} (${totalLaborHours.toFixed(1)} HH × ${formatClp(laborRatePerHour)})</td>
      </tr>
      <tr>
        <td class="lbl">Total estimado</td>
        <td class="r" style="font-weight:800;">${escapeHtml(formatClp(totalMaintenanceEstimate))}</td>
      </tr>
    </table>

    <p class="section-title">Programado vs no programado (OT cerradas)</p>
    <table class="grid2">
      <tr><td class="lbl">Programadas</td><td>${ps.programmed}</td></tr>
      <tr><td class="lbl">No programadas</td><td>${ps.notProgrammed}</td></tr>
      <tr><td class="lbl">Sin clasificar / otras</td><td>${ps.unknown}</td></tr>
    </table>

    <p class="section-title">Pareto — sistemas intervenidos (conteo OT)</p>
    <table class="items">
      <thead><tr><th>Sistema</th><th>OT</th></tr></thead>
      <tbody>
        ${
          paretoRows ||
          '<tr><td colspan="2" class="c muted">Sin intervenciones registradas en el período</td></tr>'
        }
      </tbody>
    </table>

    ${pdfElectronicFootNoteHtml([
      `Resumen mensual mantenimiento`,
      `${year}-${String(month).padStart(2, '0')}`,
      contractLabel,
    ])}
  </div>
</body>
</html>`;
}

/**
 * PDF ejecutivo: Resumen de Gestión Mensual (confiabilidad + costos de mantenimiento).
 */
export async function generateWorkOrderManagementMonthlyPdfBuffer(
  payload: WorkOrderManagementMonthlyPdfInput,
  options: WorkOrderManagementMonthlyPdfOptions = {},
): Promise<Buffer> {
  const html = buildWorkOrderManagementMonthlyHtml(payload, options);
  return renderHtmlToPdfBuffer(html);
}
