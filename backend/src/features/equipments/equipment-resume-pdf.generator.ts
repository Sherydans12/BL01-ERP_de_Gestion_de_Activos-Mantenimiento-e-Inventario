import {
  buildLogoBlockHtml,
  buildPdfDocumentBaseCss,
  escapeHtml,
  formatDateTimeEs,
  formatLongDate,
  formatNumberEs,
  pdfElectronicFootNoteHtml,
  PDF_DOC_STATUS_CSS,
  renderHtmlToPdfBuffer,
  resolveTenantAccent,
} from '../../common/pdf/pdf-html-shared';

/**
 * Hoja de vida del activo (equipo) — HTML + Chromium.
 * Patrón: `docs/agentes/pdf-html-playwright-plantilla-base.md`.
 */

export type EquipmentResumePdfEquipment = {
  internalId: string;
  plate?: string | null;
  mineInternalId?: string | null;
  brand: string;
  model: string;
  type: string;
  meterType: string;
  initialMeter: number;
  currentMeter: number;
  vin?: string | null;
  engineNumber?: string | null;
  serialNumber?: string | null;
  year?: number | null;
  fuelType?: string | null;
  driveType?: string | null;
  ownership?: string | null;
  isSubleased: boolean;
  subleaseCompanyName?: string | null;
  isOperational: boolean;
  cumulativeDowntimeHours?: { toString: () => string } | null;
  lastMaintenanceDate?: Date | null;
  lastMaintenanceMeter?: number | null;
  lastMaintenanceType?: string | null;
  techReviewExp?: Date | null;
  circPermitExp?: Date | null;
  soapExp?: Date | null;
  mechanicalCertExp?: Date | null;
  liabilityPolicyExp?: Date | null;
  contract?: { code?: string | null; name?: string | null } | null;
  subcontract?: { code?: string | null; name?: string | null } | null;
};

export type EquipmentResumePdfWorkOrder = {
  correlative: string;
  status: string;
  category: string;
  maintenanceType: string;
  description: string;
  createdAt: Date;
  closedAt?: Date | null;
  initialMeter: number;
  finalMeter?: number | null;
  metricHh?: { toString: () => string } | null;
};

export type EquipmentResumePdfMeterLog = {
  date: Date;
  oldValue: { toString: () => string };
  newValue: { toString: () => string };
  source: string;
  workOrderCorrelative?: string | null;
  user?: { name?: string | null } | null;
};

export type EquipmentResumePdfPayload = {
  equipment: EquipmentResumePdfEquipment;
  tenantName: string;
  closedWorkOrders: EquipmentResumePdfWorkOrder[];
  openWorkOrdersCount: number;
  recentMeterLogs: EquipmentResumePdfMeterLog[];
};

export type EquipmentResumePdfOptions = {
  tenantLogoDataUri?: string | null;
  tenantPrimaryColor?: string | null;
};

function meterUnitLabel(meterType: string): string {
  return meterType?.trim().toUpperCase() === 'KILOMETERS' ? 'km' : 'hrs';
}

function formatOptDate(d: Date | null | undefined): string {
  if (!d) return 'Sin registro';
  try {
    return new Intl.DateTimeFormat('es-CL', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(d);
  } catch {
    return '—';
  }
}

function maintenanceTypeLabelEs(m: string): string {
  const map: Record<string, string> = {
    PREVENTIVO: 'Preventivo',
    CORRECTIVO: 'Correctivo',
  };
  return map[m?.trim().toUpperCase()] ?? m ?? '—';
}

function categoryLabelEs(c: string): string {
  const map: Record<string, string> = {
    PROGRAMADA: 'Programada',
    NO_PROGRAMADA_CORRECTIVA: 'No programada — correctiva',
    NO_PROGRAMADA_REACTIVA: 'No programada — reactiva',
    NO_PROGRAMADA_PREVENTIVO: 'No programada — preventivo',
  };
  return map[c?.trim().toUpperCase()] ?? c ?? '—';
}

function meterSourceLabelEs(s: string): string {
  const map: Record<string, string> = {
    MANUAL: 'Manual',
    OT: 'Orden de trabajo',
    TELEMETRY: 'Telemetría',
    AVAILABILITY_REPORT: 'Parte disponibilidad',
    FAULT_REPORT: 'Reporte de falla',
  };
  return map[s?.trim().toUpperCase()] ?? s ?? '—';
}

function buildEquipmentResumeHtml(
  payload: EquipmentResumePdfPayload,
  options: EquipmentResumePdfOptions,
): string {
  const eq = payload.equipment;
  const accent = resolveTenantAccent(options.tenantPrimaryColor);
  const mu = meterUnitLabel(eq.meterType);
  const logoBlock = buildLogoBlockHtml(
    payload.tenantName,
    options.tenantLogoDataUri,
    'FL',
  );

  const contractLine = eq.contract
    ? [eq.contract.code, eq.contract.name].filter(Boolean).join(' — ').trim()
    : '';
  const subLine = eq.subcontract
    ? [eq.subcontract.code, eq.subcontract.name].filter(Boolean).join(' — ').trim()
    : '';

  const woRows = payload.closedWorkOrders.length
    ? payload.closedWorkOrders
        .map((ot) => {
          const desc = ot.description?.trim() || '—';
          const short =
            desc.length > 120 ? `${desc.slice(0, 117)}…` : desc;
          const meter =
            ot.finalMeter != null
              ? formatNumberEs(ot.finalMeter, 0)
              : formatNumberEs(ot.initialMeter, 0);
          const hh =
            ot.metricHh != null
              ? formatNumberEs(Number(ot.metricHh.toString()), 1)
              : '—';
          return `<tr>
        <td class="c">${escapeHtml(formatOptDate(ot.closedAt ?? ot.createdAt))}</td>
        <td class="c">${escapeHtml(ot.correlative)}</td>
        <td class="c">${escapeHtml(maintenanceTypeLabelEs(ot.maintenanceType))}</td>
        <td class="c">${escapeHtml(categoryLabelEs(ot.category))}</td>
        <td class="r">${escapeHtml(meter)} ${mu}</td>
        <td class="r">${escapeHtml(hh)}</td>
        <td class="l">${escapeHtml(short)}</td>
      </tr>`;
        })
        .join('')
    : `<tr><td colspan="7" class="c muted">Sin OT cerradas registradas</td></tr>`;

  const logRows = payload.recentMeterLogs.length
    ? payload.recentMeterLogs
        .map((l) => {
          const ref =
            l.source === 'OT' && l.workOrderCorrelative
              ? `OT ${l.workOrderCorrelative}`
              : meterSourceLabelEs(l.source);
          return `<tr>
        <td class="c">${escapeHtml(formatDateTimeEs(l.date))}</td>
        <td class="r">${escapeHtml(formatNumberEs(Number(l.oldValue.toString()), 0))}</td>
        <td class="r">${escapeHtml(formatNumberEs(Number(l.newValue.toString()), 0))}</td>
        <td class="c">${escapeHtml(ref)}</td>
        <td class="l">${escapeHtml(l.user?.name?.trim() || '—')}</td>
      </tr>`;
        })
        .join('')
    : `<tr><td colspan="5" class="c muted">Sin movimientos de medidor registrados</td></tr>`;

  const downtime = eq.cumulativeDowntimeHours
    ? formatNumberEs(Number(eq.cumulativeDowntimeHours.toString()), 1)
    : '0';

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <title>Hoja de vida ${escapeHtml(eq.internalId)}</title>
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
            <h1>HOJA DE VIDA DEL ACTIVO</h1>
            <p class="doc-status doc-status--caption">
              <span class="doc-status-k">Activo:</span>
              ${escapeHtml(eq.internalId)}${eq.plate?.trim() ? ` · ${escapeHtml(eq.plate.trim())}` : ''}
            </p>
          </div>
        </div>
      </div>
      <div class="meta">
        <table class="meta-t">
          <tr>
            <td>Emisión</td>
            <td>${escapeHtml(formatLongDate(new Date()))}</td>
          </tr>
          <tr>
            <td>Organización</td>
            <td>${escapeHtml(payload.tenantName)}</td>
          </tr>
          <tr>
            <td>Contrato</td>
            <td>${escapeHtml(contractLine || '—')}</td>
          </tr>
          ${
            subLine
              ? `<tr><td>Subcontrato</td><td>${escapeHtml(subLine)}</td></tr>`
              : ''
          }
          <tr>
            <td>Operativo</td>
            <td>${eq.isOperational ? 'Sí' : 'No (fuera de servicio)'}</td>
          </tr>
          <tr>
            <td>OT abiertas</td>
            <td>${payload.openWorkOrdersCount}</td>
          </tr>
        </table>
      </div>
    </div>

    <p class="section-title">Identificación técnica</p>
    <table class="grid2">
      <tr>
        <td class="lbl">N° interno</td>
        <td style="font-weight:700;">${escapeHtml(eq.internalId)}</td>
        <td class="lbl">Patente</td>
        <td>${escapeHtml(eq.plate?.trim() || '—')}</td>
      </tr>
      <tr>
        <td class="lbl">ID faena</td>
        <td>${escapeHtml(eq.mineInternalId?.trim() || '—')}</td>
        <td class="lbl">Año</td>
        <td>${eq.year != null ? escapeHtml(String(eq.year)) : '—'}</td>
      </tr>
      <tr>
        <td class="lbl">Marca / modelo</td>
        <td colspan="3">${escapeHtml(`${eq.brand} ${eq.model}`.trim())}</td>
      </tr>
      <tr>
        <td class="lbl">Tipo</td>
        <td>${escapeHtml(eq.type)}</td>
        <td class="lbl">Propiedad</td>
        <td>${escapeHtml(eq.ownership?.trim() || '—')}</td>
      </tr>
      <tr>
        <td class="lbl">VIN / chasis</td>
        <td>${escapeHtml(eq.vin?.trim() || '—')}</td>
        <td class="lbl">N° motor</td>
        <td>${escapeHtml(eq.engineNumber?.trim() || '—')}</td>
      </tr>
      <tr>
        <td class="lbl">N° serie</td>
        <td>${escapeHtml(eq.serialNumber?.trim() || '—')}</td>
        <td class="lbl">Combustible</td>
        <td>${escapeHtml(eq.fuelType?.trim() || '—')}</td>
      </tr>
      <tr>
        <td class="lbl">Tracción</td>
        <td>${escapeHtml(eq.driveType?.trim() || '—')}</td>
        <td class="lbl">Subarriendo</td>
        <td>${eq.isSubleased ? escapeHtml(eq.subleaseCompanyName?.trim() || 'Sí') : 'No'}</td>
      </tr>
    </table>

    <p class="section-title">Estado operativo y medidor</p>
    <table class="grid2">
      <tr>
        <td class="lbl">Medidor actual</td>
        <td>${formatNumberEs(eq.currentMeter, 0)} ${mu} (inicial: ${formatNumberEs(eq.initialMeter, 0)} ${mu})</td>
        <td class="lbl">Detención acum.</td>
        <td>${escapeHtml(downtime)} h</td>
      </tr>
      <tr>
        <td class="lbl">Últ. mantenimiento</td>
        <td colspan="3">
          ${eq.lastMaintenanceDate ? escapeHtml(formatOptDate(eq.lastMaintenanceDate)) : '—'}
          ${eq.lastMaintenanceMeter != null ? ` · ${formatNumberEs(eq.lastMaintenanceMeter, 0)} ${mu}` : ''}
          ${eq.lastMaintenanceType?.trim() ? ` · ${escapeHtml(eq.lastMaintenanceType.trim())}` : ''}
        </td>
      </tr>
    </table>

    <p class="section-title">Documentación y vencimientos</p>
    <table class="grid2">
      <tr>
        <td class="lbl">Rev. técnica</td>
        <td>${escapeHtml(formatOptDate(eq.techReviewExp))}</td>
        <td class="lbl">Perm. circulación</td>
        <td>${escapeHtml(formatOptDate(eq.circPermitExp))}</td>
      </tr>
      <tr>
        <td class="lbl">SOAP</td>
        <td>${escapeHtml(formatOptDate(eq.soapExp))}</td>
        <td class="lbl">Cert. mecánico</td>
        <td>${escapeHtml(formatOptDate(eq.mechanicalCertExp))}</td>
      </tr>
      <tr>
        <td class="lbl">Póliza RC</td>
        <td colspan="3">${escapeHtml(formatOptDate(eq.liabilityPolicyExp))}</td>
      </tr>
    </table>

    <p class="section-title">Historial de mantenimiento (últimas ${payload.closedWorkOrders.length} OT cerradas)</p>
    <table class="items">
      <colgroup>
        <col style="width:11%;" />
        <col style="width:10%;" />
        <col style="width:11%;" />
        <col style="width:16%;" />
        <col style="width:9%;" />
        <col style="width:7%;" />
        <col style="width:36%;" />
      </colgroup>
      <thead>
        <tr>
          <th>Cierre</th>
          <th>OT</th>
          <th>Tipo</th>
          <th>Categoría</th>
          <th>Medidor</th>
          <th>HH</th>
          <th>Descripción</th>
        </tr>
      </thead>
      <tbody>${woRows}</tbody>
    </table>

    <p class="section-title">Últimos movimientos de medidor</p>
    <table class="items">
      <thead>
        <tr>
          <th>Fecha</th>
          <th>Anterior</th>
          <th>Nuevo</th>
          <th>Origen</th>
          <th>Usuario</th>
        </tr>
      </thead>
      <tbody>${logRows}</tbody>
    </table>

    ${pdfElectronicFootNoteHtml([
      `Hoja de vida activo ${eq.internalId}`,
      payload.tenantName,
    ])}
  </div>
</body>
</html>`;
}

export async function generateEquipmentResumePdfBuffer(
  payload: EquipmentResumePdfPayload,
  options: EquipmentResumePdfOptions = {},
): Promise<Buffer> {
  const html = buildEquipmentResumeHtml(payload, options);
  return renderHtmlToPdfBuffer(html);
}
