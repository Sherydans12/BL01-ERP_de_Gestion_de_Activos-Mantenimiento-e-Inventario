import {
  buildPdfDocumentBaseCss,
  escapeHtml,
  formatDateTimeEs,
  formatLongDate,
  formatNumberEs,
  pdfElectronicFootNoteHtml,
  renderHtmlToPdfBuffer,
  resolveTenantAccent,
} from '../../common/pdf/pdf-html-shared';

/**
 * PDF formal de orden de trabajo (HTML → Chromium).
 * Patrón: `docs/agentes/pdf-html-playwright-plantilla-base.md`.
 */

export type WoPdfOrder = {
  correlative: string;
  status: string;
  type: string;
  category: string;
  maintenanceType: string;
  description: string;
  responsible?: string | null;
  initialMeter: number;
  finalMeter?: number | null;
  detentionStartedAt?: Date | null;
  detentionEndedAt?: Date | null;
  detentionInitialMeter?: number | null;
  detentionFinalMeter?: number | null;
  mechanicAttentionStartedAt?: Date | null;
  mechanicAttentionEndedAt?: Date | null;
  personnelQuantity: number;
  clientAttributedStart?: Date | null;
  clientAttributedEnd?: Date | null;
  clientAttributedReason?: string | null;
  affectsAvailability?: string | null;
  classificationTags: string[];
  workLocation?: string | null;
  workShift?: string | null;
  metricHm?: { toString: () => string } | null;
  metricHh?: { toString: () => string } | null;
  initialRequestDescription?: string | null;
  symptomsText?: string | null;
  causeText?: string | null;
  workPerformedDescription?: string | null;
  techniciansNames?: string | null;
  responsibleMechanicName?: string | null;
  shiftSupervisorName?: string | null;
  pmCycleNumber?: number | null;
  closureEquipmentOperational?: boolean | null;
  createdAt: Date;
  inProgressAt?: Date | null;
  closedAt?: Date | null;
  subcontract?: { code?: string | null; name?: string | null } | null;
  warehouse?: { code?: string | null; name?: string | null } | null;
  equipment: {
    internalId: string;
    plate?: string | null;
    brand: string;
    model: string;
    type: string;
    meterType: string;
    currentMeter: number;
    vin?: string | null;
    serialNumber?: string | null;
    year?: number | null;
    isOperational: boolean;
    contract?: { code?: string | null; name?: string | null } | null;
    subcontract?: { code?: string | null; name?: string | null } | null;
  };
  tenant?: {
    name: string;
    rut?: string | null;
    primaryColor?: string | null;
  } | null;
  createdByUser?: { name?: string | null; email?: string | null } | null;
  shiftSupervisorUser?: { name?: string | null; email?: string | null } | null;
  systems: Array<{ catalogItem?: { name?: string | null; code?: string | null } | null }>;
  tasks: Array<{
    description: string;
    action?: string | null;
    estimatedHours?: number | null;
    isCompleted: boolean;
    observation?: string | null;
    measurement?: number | null;
    trackingCode?: string | null;
  }>;
  parts: Array<{
    partNumber: string;
    description: string;
    quantity: number;
    unitCost?: number | null;
    inventoryItem?: {
      partNumber?: string | null;
      name?: string | null;
      description?: string | null;
      inventoryCode?: string | null;
    } | null;
  }>;
  fluids: Array<{
    liters: number;
    action: string;
    catalogItem?: { name?: string | null; code?: string | null } | null;
  }>;
  fluidCompartments: Array<{
    compartment: string;
    fluidType: string;
    liters: { toString: () => string };
    action: string;
    inventoryItem?: {
      partNumber?: string | null;
      name?: string | null;
    } | null;
  }>;
  fluidSamples: Array<{
    bottleCode: string;
    status: string;
    results?: string | null;
    system?: { name?: string | null } | null;
  }>;
  backlogItems: Array<{
    description: string;
    status: string;
  }>;
  stockReservations: Array<{
    quantity: number;
    item?: {
      partNumber?: string | null;
      name?: string | null;
      description?: string | null;
      inventoryCode?: string | null;
    } | null;
    warehouse?: { code?: string | null; name?: string | null } | null;
  }>;
  purchaseRequisitions: Array<{
    correlative: string;
    status: string;
  }>;
  purchaseOrders: Array<{
    correlative: string;
    status: string;
  }>;
  faultReport?: {
    correlative: string;
    criticality: string;
    affectedSystem: string;
    status: string;
    eventDate: Date;
    symptomDescription: string;
    meterAtFault?: number | null;
  } | null;
};

export type WoPdfOptions = {
  tenantLogoDataUri?: string | null;
};

function otStatusLabelEs(status: string): string {
  const map: Record<string, string> = {
    OPEN: 'Abierta',
    IN_PROGRESS: 'En progreso',
    ON_HOLD: 'En espera',
    CLOSED: 'Cerrada',
  };
  return map[status?.trim().toUpperCase()] ?? status ?? '—';
}

function otStatusBadgeMod(status: string): string {
  const map: Record<string, string> = {
    OPEN: 'doc-status--neutral',
    IN_PROGRESS: 'doc-status--progress',
    ON_HOLD: 'doc-status--warning',
    CLOSED: 'doc-status--closed',
  };
  return map[status?.trim().toUpperCase()] ?? 'doc-status--neutral';
}

function otCategoryLabelEs(c: string): string {
  const map: Record<string, string> = {
    PROGRAMADA: 'Programada',
    NO_PROGRAMADA_CORRECTIVA: 'No programada — correctiva',
    NO_PROGRAMADA_REACTIVA: 'No programada — reactiva',
    NO_PROGRAMADA_PREVENTIVO: 'No programada — preventivo',
  };
  return map[c?.trim().toUpperCase()] ?? c ?? '—';
}

function otTypeLabelEs(t: string): string {
  const map: Record<string, string> = {
    NUEVA: 'Nueva',
    CONTINUIDAD: 'Continuidad',
  };
  return map[t?.trim().toUpperCase()] ?? t ?? '—';
}

function maintenanceTypeLabelEs(m: string): string {
  const map: Record<string, string> = {
    PREVENTIVO: 'Preventivo',
    CORRECTIVO: 'Correctivo',
  };
  return map[m?.trim().toUpperCase()] ?? m ?? '—';
}

function availabilityLabelEs(v: string | null | undefined): string {
  const map: Record<string, string> = {
    SI: 'Sí — afecta disponibilidad',
    NO: 'No afecta disponibilidad',
    STP: 'Standby / STP',
  };
  return v ? map[v.trim().toUpperCase()] ?? v : '—';
}

function workLocationLabelEs(v: string | null | undefined): string {
  const map: Record<string, string> = {
    TALLER: 'Taller',
    TERRENO: 'Terreno',
  };
  return v ? map[v.trim().toUpperCase()] ?? v : '—';
}

function workShiftLabelEs(v: string | null | undefined): string {
  const map: Record<string, string> = {
    DIA: 'Día',
    NOCHE: 'Noche',
  };
  return v ? map[v.trim().toUpperCase()] ?? v : '—';
}

function classificationTagLabelEs(tag: string): string {
  const map: Record<string, string> = {
    PROGRAMADA: 'Programada',
    NO_PROGRAMADA: 'No programada',
    NP_PREVENTIVO: 'NP — Preventivo',
    NP_CORRECTIVO: 'NP — Correctivo',
    ACCIDENTE_INCIDENTE: 'Accidente / incidente',
    OT_ABIERTA_CONTINUIDAD: 'OT abierta — continuidad',
    OT_ABIERTA_GEN_BCK: 'OT abierta — backlog general',
    POSIBLE_GARANTIA: 'Posible garantía',
  };
  return map[tag.trim().toUpperCase()] ?? tag.replace(/_/g, ' ');
}

function fluidActionLabelEs(a: string): string {
  const map: Record<string, string> = {
    RELLENO: 'Relleno',
    CAMBIO: 'Cambio',
  };
  return map[a?.trim().toUpperCase()] ?? a ?? '—';
}

function fluidCompartmentLabelEs(c: string): string {
  const map: Record<string, string> = {
    MOTOR: 'Motor',
    TRANSMISION: 'Transmisión',
    DIRECCION: 'Dirección',
    HIDRAULICO: 'Hidráulico',
    MANDOS: 'Mandos',
    DIFERENCIAL: 'Diferencial',
    REFRIGERANTE: 'Refrigerante',
    OTROS: 'Otros',
  };
  return map[c?.trim().toUpperCase()] ?? c ?? '—';
}

function taskActionLabelEs(a: string | null | undefined): string {
  const map: Record<string, string> = {
    INSPECT: 'Inspección',
    REPLACE: 'Reemplazo',
    ADJUST: 'Ajuste',
    CLEAN: 'Limpieza',
    LUBRICATE: 'Lubricación',
  };
  return a ? map[a.trim().toUpperCase()] ?? a : '—';
}

function sampleStatusLabelEs(s: string): string {
  const map: Record<string, string> = {
    PENDING: 'Pendiente',
    SENT_TO_LAB: 'Enviada a laboratorio',
    ANALYZED: 'Analizada',
  };
  return map[s?.trim().toUpperCase()] ?? s ?? '—';
}

function backlogStatusLabelEs(s: string): string {
  const map: Record<string, string> = {
    PENDING: 'Pendiente',
    DONE: 'Realizado',
  };
  return map[s?.trim().toUpperCase()] ?? s ?? '—';
}

function purchaseDocStatusLabelEs(s: string): string {
  const map: Record<string, string> = {
    DRAFT: 'Borrador',
    SUBMITTED: 'Enviado',
    PENDING_APPROVAL: 'Pend. aprobación',
    APPROVED: 'Aprobado',
    CLOSED: 'Cerrado',
    CANCELLED: 'Anulado',
    SENT_TO_SUPPLIER: 'Enviada proveedor',
    RECEIVED: 'Recepcionada',
  };
  return map[s?.trim().toUpperCase()] ?? s ?? '—';
}

function faultCriticalityLabelEs(c: string): string {
  const map: Record<string, string> = {
    HIGH: 'Alta',
    MEDIUM: 'Media',
    LOW: 'Baja',
  };
  return map[c?.trim().toUpperCase()] ?? c ?? '—';
}

function faultSystemLabelEs(s: string): string {
  const map: Record<string, string> = {
    MOTOR: 'Motor',
    HYDRAULIC: 'Hidráulico',
    ELECTRICAL: 'Eléctrico',
    POWER_TRAIN: 'Tren de potencia',
    STRUCTURE: 'Estructura',
    GET_WEAR: 'Desgaste (GET)',
    TIRES_TRACKS: 'Neumáticos / orugas',
  };
  return map[s?.trim().toUpperCase()] ?? s ?? '—';
}

function meterUnitLabel(meterType: string): string {
  return meterType?.trim().toUpperCase() === 'KILOMETERS' ? 'km' : 'hrs';
}

function fmtOptDate(d: Date | null | undefined): string {
  return d ? formatDateTimeEs(d) : '—';
}

function narrativeBlock(label: string, text: string | null | undefined): string {
  const t = text?.trim();
  if (!t) return '';
  return `<div class="narrative"><span class="lbl-inline">${escapeHtml(label)}</span>${escapeHtml(t)}</div>`;
}

function buildLogoBlock(
  tenant: WoPdfOrder['tenant'],
  options: WoPdfOptions,
): string {
  if (options.tenantLogoDataUri) {
    return `<img class="logo" src="${options.tenantLogoDataUri}" alt="" />`;
  }
  const initials = tenant?.name?.slice(0, 3).toUpperCase() || 'OT';
  return `<div class="logo-ph">${escapeHtml(initials)}</div>`;
}

function buildWorkOrderHtml(order: WoPdfOrder, options: WoPdfOptions): string {
  const tenant = order.tenant;
  const accent = resolveTenantAccent(tenant?.primaryColor);
  const eq = order.equipment;
  const mu = meterUnitLabel(eq.meterType);

  const contractLine = eq.contract
    ? [eq.contract.code, eq.contract.name].filter(Boolean).join(' — ').trim()
    : '';
  const subLine = order.subcontract
    ? [order.subcontract.code, order.subcontract.name].filter(Boolean).join(' — ').trim()
    : eq.subcontract
      ? [eq.subcontract.code, eq.subcontract.name].filter(Boolean).join(' — ').trim()
      : '';

  const tagsHtml =
    order.classificationTags?.length > 0
      ? `<ul class="tag-list">${order.classificationTags
          .map(
            (t) =>
              `<li>${escapeHtml(classificationTagLabelEs(t))}</li>`,
          )
          .join('')}</ul>`
      : '<span class="muted">Sin etiquetas de clasificación</span>';

  const closureOp =
    order.closureEquipmentOperational === true
      ? 'Equipo operativo al cierre'
      : order.closureEquipmentOperational === false
        ? 'Equipo fuera de servicio al cierre'
        : '—';

  const partsTotal = order.parts.reduce((sum, p) => {
    const u = p.unitCost ?? 0;
    return sum + u * p.quantity;
  }, 0);

  const systemsRows = order.systems.length
    ? order.systems
        .map(
          (s, i) => `<tr>
        <td class="c">${i + 1}</td>
        <td class="l">${escapeHtml(s.catalogItem?.name || s.catalogItem?.code || '—')}</td>
        <td class="c">${escapeHtml(s.catalogItem?.code?.trim() || '—')}</td>
      </tr>`,
        )
        .join('')
    : `<tr><td colspan="3" class="c muted">Sin sistemas registrados</td></tr>`;

  const tasksRows = order.tasks.length
    ? order.tasks
        .map(
          (t) => `<tr>
        <td class="l">${escapeHtml(t.description)}</td>
        <td class="c">${escapeHtml(taskActionLabelEs(t.action))}</td>
        <td class="c">${t.isCompleted ? 'Sí' : 'No'}</td>
        <td class="c">${t.estimatedHours != null ? formatNumberEs(t.estimatedHours, 1) : '—'}</td>
        <td class="l">${escapeHtml(t.observation?.trim() || '—')}</td>
      </tr>`,
        )
        .join('')
    : `<tr><td colspan="5" class="c muted">Sin tareas registradas</td></tr>`;

  const partsRows = order.parts.length
    ? order.parts
        .map((p) => {
          const pn =
            p.inventoryItem?.partNumber?.trim() ||
            p.inventoryItem?.inventoryCode?.trim() ||
            p.partNumber;
          const lineTotal =
            p.unitCost != null ? p.unitCost * p.quantity : null;
          const itemName =
            p.inventoryItem?.name?.trim() || p.description?.trim() || '—';
          const itemDesc =
            p.inventoryItem?.description?.trim() ||
            (p.description?.trim() && p.description.trim() !== itemName
              ? p.description.trim()
              : '') ||
            '—';
          return `<tr>
        <td class="l">${escapeHtml(pn)}</td>
        <td class="l">${escapeHtml(itemName)}</td>
        <td class="l muted">${escapeHtml(itemDesc)}</td>
        <td class="c">${formatNumberEs(p.quantity, 3)}</td>
        <td class="r">${p.unitCost != null ? formatNumberEs(p.unitCost) : '—'}</td>
        <td class="r">${lineTotal != null ? formatNumberEs(lineTotal) : '—'}</td>
      </tr>`;
        })
        .join('')
    : `<tr><td colspan="6" class="c muted">Sin repuestos registrados</td></tr>`;

  const fluidsRows =
    order.fluids.length > 0
      ? order.fluids
          .map(
            (f) => `<tr>
        <td class="l">${escapeHtml(f.catalogItem?.name || f.catalogItem?.code || '—')}</td>
        <td class="r">${formatNumberEs(f.liters, 3)}</td>
        <td class="c">${escapeHtml(fluidActionLabelEs(f.action))}</td>
      </tr>`,
          )
          .join('')
      : '';

  const compartmentRows =
    order.fluidCompartments.length > 0
      ? order.fluidCompartments
          .map(
            (fc) => `<tr>
        <td class="l">${escapeHtml(fluidCompartmentLabelEs(fc.compartment))}</td>
        <td class="l">${escapeHtml(fc.inventoryItem?.name?.trim() || fc.fluidType)}</td>
        <td class="r">${formatNumberEs(Number(fc.liters.toString()), 3)}</td>
        <td class="c">${escapeHtml(fluidActionLabelEs(fc.action))}</td>
      </tr>`,
          )
          .join('')
      : '';

  const samplesRows = order.fluidSamples.length
    ? order.fluidSamples
        .map(
          (s) => `<tr>
        <td class="l">${escapeHtml(s.system?.name || '—')}</td>
        <td class="c">${escapeHtml(s.bottleCode)}</td>
        <td class="c">${escapeHtml(sampleStatusLabelEs(s.status))}</td>
        <td class="l">${escapeHtml(s.results?.trim() || '—')}</td>
      </tr>`,
        )
        .join('')
    : '';

  const backlogRows = order.backlogItems.length
    ? order.backlogItems
        .map(
          (b) => `<tr>
        <td class="l">${escapeHtml(b.description)}</td>
        <td class="c">${escapeHtml(backlogStatusLabelEs(b.status))}</td>
      </tr>`,
        )
        .join('')
    : '';

  const reservationRows = order.stockReservations.length
    ? order.stockReservations
        .map((r) => {
          const wh = r.warehouse
            ? [r.warehouse.code, r.warehouse.name].filter(Boolean).join(' — ')
            : '—';
          const itemLabel = r.item
            ? [
                r.item.partNumber || r.item.inventoryCode,
                r.item.name,
                r.item.description &&
                r.item.description.trim() !== r.item.name?.trim()
                  ? r.item.description.trim()
                  : null,
              ]
                .filter(Boolean)
                .join(' — ')
            : '—';
          return `<tr>
        <td class="l">${escapeHtml(itemLabel)}</td>
        <td class="c">${escapeHtml(wh)}</td>
        <td class="r">${formatNumberEs(r.quantity, 3)}</td>
      </tr>`;
        })
        .join('')
    : '';

  const srcRows = order.purchaseRequisitions.length
    ? order.purchaseRequisitions
        .map(
          (r) => `<tr>
        <td class="c">${escapeHtml(r.correlative)}</td>
        <td class="c">${escapeHtml(purchaseDocStatusLabelEs(r.status))}</td>
      </tr>`,
        )
        .join('')
    : '';

  const ocRows = order.purchaseOrders.length
    ? order.purchaseOrders
        .map(
          (po) => `<tr>
        <td class="c">${escapeHtml(po.correlative)}</td>
        <td class="c">${escapeHtml(purchaseDocStatusLabelEs(po.status))}</td>
      </tr>`,
        )
        .join('')
    : '';

  const faultBlock = order.faultReport
    ? `<div class="dest"><strong>Reporte de falla vinculado (${escapeHtml(order.faultReport.correlative)})</strong><br/>
      Criticidad: ${escapeHtml(faultCriticalityLabelEs(order.faultReport.criticality))} ·
      Sistema: ${escapeHtml(faultSystemLabelEs(order.faultReport.affectedSystem))} ·
      Estado: ${escapeHtml(order.faultReport.status)}<br/>
      Fecha evento: ${escapeHtml(formatDateTimeEs(order.faultReport.eventDate))}
      ${order.faultReport.meterAtFault != null ? ` · Medidor: ${formatNumberEs(order.faultReport.meterAtFault, 0)} ${mu}` : ''}<br/>
      ${escapeHtml(order.faultReport.symptomDescription)}</div>`
    : '';

  const supervisorLine = [
    order.shiftSupervisorName?.trim(),
    order.shiftSupervisorUser?.name?.trim(),
    order.shiftSupervisorUser?.email?.trim(),
  ]
    .filter(Boolean)
    .join(' · ');

  const mechanicLine = [
    order.responsibleMechanicName?.trim(),
    order.techniciansNames?.trim(),
    order.responsible?.trim(),
  ]
    .filter(Boolean)
    .join(' · ');

  const createdByLine = [
    order.createdByUser?.name?.trim(),
    order.createdByUser?.email?.trim(),
  ]
    .filter(Boolean)
    .join(' · ');

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <title>Orden de trabajo ${escapeHtml(order.correlative)}</title>
  <style>${buildPdfDocumentBaseCss(accent)}</style>
</head>
<body>
  <div class="wrap">
    <div class="top">
      <div class="top-doc">
        <div class="doc-brand">
          <div class="logo-corner">${buildLogoBlock(tenant, options)}</div>
          <div class="title-block">
            <h1>ORDEN DE TRABAJO</h1>
            <p class="doc-status ${otStatusBadgeMod(order.status)}">
              <span class="doc-status-k">Estado:</span>
              ${escapeHtml(otStatusLabelEs(order.status))}
            </p>
          </div>
        </div>
      </div>
      <div class="meta">
        <table class="meta-t">
          <tr>
            <td>Nº OT</td>
            <td style="font-weight:800;font-size:11px;">${escapeHtml(order.correlative)}</td>
          </tr>
          <tr>
            <td>Creación</td>
            <td>${escapeHtml(formatLongDate(order.createdAt))}</td>
          </tr>
          <tr>
            <td>En curso</td>
            <td>${escapeHtml(fmtOptDate(order.inProgressAt))}</td>
          </tr>
          <tr>
            <td>Cierre</td>
            <td>${escapeHtml(fmtOptDate(order.closedAt))}</td>
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
            <td>Bodega</td>
            <td>${escapeHtml(
              order.warehouse
                ? [order.warehouse.code, order.warehouse.name]
                    .filter(Boolean)
                    .join(' — ')
                : '—',
            )}</td>
          </tr>
          <tr>
            <td>Organización</td>
            <td>${escapeHtml(tenant?.name?.trim() || '—')}</td>
          </tr>
        </table>
      </div>
    </div>

    <div class="dest"><strong>Clasificación</strong><br/>${tagsHtml}</div>

    <p class="section-title">Identificación y planificación</p>
    <table class="grid2">
      <tr>
        <td class="lbl">Tipo OT</td>
        <td>${escapeHtml(otTypeLabelEs(order.type))}</td>
        <td class="lbl">Categoría</td>
        <td>${escapeHtml(otCategoryLabelEs(order.category))}</td>
      </tr>
      <tr>
        <td class="lbl">Mantenimiento</td>
        <td>${escapeHtml(maintenanceTypeLabelEs(order.maintenanceType))}</td>
        <td class="lbl">Ciclo PM</td>
        <td>${order.pmCycleNumber != null ? escapeHtml(String(order.pmCycleNumber)) : '—'}</td>
      </tr>
      <tr>
        <td class="lbl">Disponibilidad</td>
        <td colspan="3">${escapeHtml(availabilityLabelEs(order.affectsAvailability))}</td>
      </tr>
      <tr>
        <td class="lbl">Ubicación</td>
        <td>${escapeHtml(workLocationLabelEs(order.workLocation))}</td>
        <td class="lbl">Turno</td>
        <td>${escapeHtml(workShiftLabelEs(order.workShift))}</td>
      </tr>
      <tr>
        <td class="lbl">Registrada por</td>
        <td colspan="3">${escapeHtml(createdByLine || '—')}</td>
      </tr>
      <tr>
        <td class="lbl">Supervisor</td>
        <td colspan="3">${escapeHtml(supervisorLine || '—')}</td>
      </tr>
      <tr>
        <td class="lbl">Cierre equipo</td>
        <td colspan="3">${escapeHtml(closureOp)}</td>
      </tr>
    </table>

    <p class="section-title">Equipo</p>
    <table class="grid2">
      <tr>
        <td class="lbl">N° interno</td>
        <td style="font-weight:700;">${escapeHtml(eq.internalId)}</td>
        <td class="lbl">Patente</td>
        <td>${escapeHtml(eq.plate?.trim() || '—')}</td>
      </tr>
      <tr>
        <td class="lbl">Marca / modelo</td>
        <td colspan="3">${escapeHtml(`${eq.brand} ${eq.model}`.trim())}</td>
      </tr>
      <tr>
        <td class="lbl">Tipo</td>
        <td>${escapeHtml(eq.type)}</td>
        <td class="lbl">Año</td>
        <td>${eq.year != null ? escapeHtml(String(eq.year)) : '—'}</td>
      </tr>
      <tr>
        <td class="lbl">Medidor (${mu})</td>
        <td>Inicial: ${formatNumberEs(order.initialMeter, 0)} · Final: ${order.finalMeter != null ? formatNumberEs(order.finalMeter, 0) : '—'} · Actual: ${formatNumberEs(eq.currentMeter, 0)}</td>
        <td class="lbl">Operativo</td>
        <td>${eq.isOperational ? 'Sí' : 'No'}</td>
      </tr>
      <tr>
        <td class="lbl">VIN</td>
        <td>${escapeHtml(eq.vin?.trim() || '—')}</td>
        <td class="lbl">Serie</td>
        <td>${escapeHtml(eq.serialNumber?.trim() || '—')}</td>
      </tr>
    </table>

    <p class="section-title">Tiempos y detención</p>
    <table class="grid2">
      <tr>
        <td class="lbl">Detención inicio</td>
        <td>${escapeHtml(fmtOptDate(order.detentionStartedAt))}</td>
        <td class="lbl">Detención fin</td>
        <td>${escapeHtml(fmtOptDate(order.detentionEndedAt))}</td>
      </tr>
      <tr>
        <td class="lbl">Med. detención</td>
        <td>${order.detentionInitialMeter != null ? `${formatNumberEs(order.detentionInitialMeter, 0)} ${mu}` : '—'} → ${order.detentionFinalMeter != null ? `${formatNumberEs(order.detentionFinalMeter, 0)} ${mu}` : '—'}</td>
        <td class="lbl">Técnicos (N)</td>
        <td>${escapeHtml(String(order.personnelQuantity))}</td>
      </tr>
      <tr>
        <td class="lbl">Atención mec.</td>
        <td colspan="3">${escapeHtml(fmtOptDate(order.mechanicAttentionStartedAt))} → ${escapeHtml(fmtOptDate(order.mechanicAttentionEndedAt))}</td>
      </tr>
      <tr>
        <td class="lbl">HM / HH</td>
        <td>HM: ${order.metricHm != null ? formatNumberEs(Number(order.metricHm.toString()), 2) : '—'} · HH: ${order.metricHh != null ? formatNumberEs(Number(order.metricHh.toString()), 2) : '—'}</td>
        <td class="lbl">Atrib. cliente</td>
        <td>${escapeHtml(fmtOptDate(order.clientAttributedStart))}${order.clientAttributedEnd ? ` → ${escapeHtml(fmtOptDate(order.clientAttributedEnd))}` : ''}</td>
      </tr>
      ${
        order.clientAttributedReason?.trim()
          ? `<tr><td class="lbl">Motivo cliente</td><td colspan="3">${escapeHtml(order.clientAttributedReason.trim())}</td></tr>`
          : ''
      }
    </table>

    ${faultBlock}

    <p class="section-title">Descripción y diagnóstico</p>
    ${narrativeBlock('Descripción general', order.description)}
    ${narrativeBlock('Solicitud inicial', order.initialRequestDescription)}
    ${narrativeBlock('Síntomas', order.symptomsText)}
    ${narrativeBlock('Causa', order.causeText)}
    ${narrativeBlock('Trabajo realizado', order.workPerformedDescription)}

    <p class="section-title">Sistemas intervenidos</p>
    <table class="items">
      <colgroup>
        <col style="width:8%;" />
        <col style="width:62%;" />
        <col style="width:30%;" />
      </colgroup>
      <thead>
        <tr><th>#</th><th>Sistema</th><th>Código</th></tr>
      </thead>
      <tbody>${systemsRows}</tbody>
    </table>

    <p class="section-title">Tareas</p>
    <table class="items">
      <colgroup>
        <col style="width:32%;" />
        <col style="width:14%;" />
        <col style="width:10%;" />
        <col style="width:10%;" />
        <col style="width:34%;" />
      </colgroup>
      <thead>
        <tr><th>Descripción</th><th>Acción</th><th>Hecha</th><th>H. est.</th><th>Observación</th></tr>
      </thead>
      <tbody>${tasksRows}</tbody>
    </table>

    <p class="section-title">Repuestos y materiales</p>
    <table class="items">
      <colgroup>
        <col style="width:16%;" />
        <col style="width:38%;" />
        <col style="width:12%;" />
        <col style="width:16%;" />
        <col style="width:18%;" />
      </colgroup>
      <thead>
        <tr><th>Código</th><th>Nombre</th><th>Descripción</th><th>Cant.</th><th>P. unit.</th><th>Total ref.</th></tr>
      </thead>
      <tbody>${partsRows}</tbody>
    </table>
    ${
      order.parts.length > 0
        ? `<p class="muted" style="text-align:right;margin:0 0 8px;">Total referencial repuestos: ${formatNumberEs(partsTotal)} (CLP ref. si aplica)</p>`
        : ''
    }

    ${
      fluidsRows
        ? `<p class="section-title">Fluidos (catálogo)</p>
    <table class="items">
      <thead><tr><th>Fluido</th><th>Cantidad (L)</th><th>Acción</th></tr></thead>
      <tbody>${fluidsRows}</tbody>
    </table>`
        : ''
    }

    ${
      compartmentRows
        ? `<p class="section-title">Fluidos por compartimiento</p>
    <table class="items">
      <thead><tr><th>Compartimiento</th><th>Producto</th><th>Litros</th><th>Acción</th></tr></thead>
      <tbody>${compartmentRows}</tbody>
    </table>`
        : ''
    }

    ${
      samplesRows
        ? `<p class="section-title">Muestras de aceite (APD)</p>
    <table class="items">
      <thead><tr><th>Sistema</th><th>Frasco</th><th>Estado</th><th>Resultados</th></tr></thead>
      <tbody>${samplesRows}</tbody>
    </table>`
        : ''
    }

    ${
      backlogRows
        ? `<p class="section-title">Backlog pendiente en OT</p>
    <table class="items">
      <thead><tr><th>Ítem</th><th>Estado</th></tr></thead>
      <tbody>${backlogRows}</tbody>
    </table>`
        : ''
    }

    ${
      reservationRows
        ? `<p class="section-title">Reservas de stock</p>
    <table class="items">
      <thead><tr><th>Artículo</th><th>Bodega</th><th>Cantidad</th></tr></thead>
      <tbody>${reservationRows}</tbody>
    </table>`
        : ''
    }

    ${
      srcRows || ocRows
        ? `<p class="section-title">Trazabilidad compras</p>
      ${
        srcRows
          ? `<table class="items" style="margin-bottom:4px;">
        <thead><tr><th>SRC</th><th>Estado</th></tr></thead>
        <tbody>${srcRows}</tbody>
      </table>`
          : ''
      }
      ${
        ocRows
          ? `<table class="items">
        <thead><tr><th>OC</th><th>Estado</th></tr></thead>
        <tbody>${ocRows}</tbody>
      </table>`
          : ''
      }`
        : ''
    }

    <div class="foot-sigs">
      <div class="sig-box">
        <div class="sig-title">Mecánico / ejecutor</div>
        ${escapeHtml(mechanicLine || 'Nombre: _________________________')}
      </div>
      <div class="sig-box">
        <div class="sig-title">Supervisor de turno</div>
        ${escapeHtml(supervisorLine || 'Nombre: _________________________')}
      </div>
    </div>

    ${pdfElectronicFootNoteHtml([`OT ${order.correlative}`])}
  </div>
</body>
</html>`;
}

export async function generateWorkOrderPdfBuffer(
  order: WoPdfOrder,
  options: WoPdfOptions = {},
): Promise<Buffer> {
  const html = buildWorkOrderHtml(order, options);
  return renderHtmlToPdfBuffer(html);
}
