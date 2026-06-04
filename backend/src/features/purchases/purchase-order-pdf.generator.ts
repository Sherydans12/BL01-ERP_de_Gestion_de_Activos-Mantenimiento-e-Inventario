import { chromium } from 'playwright';
import { catalogItemLineLabel } from '../../common/pdf/item-catalog-display.util';
import { pdfElectronicFootNoteHtml } from '../../common/pdf/pdf-html-shared';

/**
 * PDF formal de orden de compra (HTML → Chromium → PDF).
 * Patrón de plantilla reutilizable para otros documentos: ver
 * `docs/agentes/pdf-html-playwright-plantilla-base.md`.
 */

/** Datos mínimos para el PDF formal de OC (alineado al include de `getPurchaseOrderPdfStream`). */
export type PoPdfOrder = {
  correlative: string;
  status: string;
  totalAmount: { toString: () => string };
  currency: string;
  createdAt: Date;
  paymentTerms?: string | null;
  deliveryAddress?: string | null;
  notes?: string | null;
  contract?: { code?: string; name?: string } | null;
  subcontract?: { code?: string; name?: string } | null;
  quotation?: {
    paymentDays?: number | null;
    vendor?: {
      name?: string;
      code?: string;
      rut?: string | null;
      address?: string | null;
      city?: string | null;
      businessActivity?: string | null;
      fax?: string | null;
      contactPhone?: string | null;
      contactEmail?: string | null;
    } | null;
  } | null;
  requisition?: { correlative: string } | null;
  tenant?: {
    name: string;
    rut?: string | null;
    address?: string | null;
    phone?: string | null;
    city?: string | null;
    invoiceLegalName?: string | null;
    /** Aviso del recuadro `.warn` en PDF OC; vacío = texto por defecto. */
    ocPdfLegalNotice?: string | null;
    primaryColor?: string | null;
  } | null;
  equipment?: {
    internalId: string;
    brand: string;
    model: string;
    plate?: string | null;
  } | null;
  workOrder?: { correlative: string; description: string } | null;
  items: Array<{
    description: string;
    quantity: unknown;
    unitCost: { toString: () => string };
    inventoryItem?: {
      partNumber?: string | null;
      name?: string | null;
      description?: string | null;
    } | null;
  }>;
};

export type PoPdfOptions = {
  /** data:image/...;base64,... opcional (logo tenant). */
  tenantLogoDataUri?: string | null;
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/** Texto por defecto del aviso en el PDF de OC si `Tenant.ocPdfLegalNotice` está vacío. */
const DEFAULT_OC_PDF_LEGAL_NOTICE_LINES: readonly string[] = [
  'Adjuntar la presente orden de compra a la factura emitida, o será rechazada y devuelta.',
  'Para pago de facturas llamar al fono 2 8988948 o al correo electrónico de don Pablo Ortiz (portiz@powertrak.cl)',
];

function ocPdfLegalNoticeHtml(
  tenant: PoPdfOrder['tenant'] | null | undefined,
): string {
  const raw = tenant?.ocPdfLegalNotice?.trim();
  const lines = raw
    ? raw
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0)
    : [...DEFAULT_OC_PDF_LEGAL_NOTICE_LINES];
  return lines.map((line) => escapeHtml(line)).join('<br/>');
}

function formatNumberEs(n: number, maxFrac = 2): string {
  try {
    return n.toLocaleString('es-CL', {
      minimumFractionDigits: 0,
      maximumFractionDigits: maxFrac,
    });
  } catch {
    return String(n);
  }
}

function formatLongDate(d: Date): string {
  try {
    return new Intl.DateTimeFormat('es-CL', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

function formatPaymentDaysLabel(days: number): string {
  if (days <= 0) return 'Contado';
  return `${days} día${days === 1 ? '' : 's'}`;
}

/** Etiqueta en español para el enum `PurchaseOrderStatus` en PDFs. */
function purchaseOrderStatusLabelEs(status: string | undefined | null): string {
  const s = (status || '').trim().toUpperCase();
  const map: Record<string, string> = {
    DRAFT: 'Borrador',
    PENDING_APPROVAL: 'Pendiente de aprobación',
    PARTIALLY_APPROVED: 'Aprobación parcial',
    APPROVED: 'Aprobada',
    REJECTED: 'Rechazada',
    SENT: 'Enviada al proveedor',
    ORDERED: 'Pedido al proveedor',
    SENT_TO_SUPPLIER: 'Enviada al proveedor',
    PARTIALLY_RECEIVED: 'Recepción parcial',
    RECEIVED: 'Recepción completa',
    CLOSED: 'Cerrada',
    CANCELLED: 'Anulada',
  };
  return map[s] || s || '—';
}

/**
 * Modificador de estilo para el badge de estado en cabecera PDF (`.doc-status--*`).
 * Colores alineados a severidad / etapa del flujo de compra.
 */
function purchaseOrderStatusBadgeMod(
  status: string | undefined | null,
): string {
  const s = (status || '').trim().toUpperCase();
  const map: Record<string, string> = {
    DRAFT: 'doc-status--neutral',
    PENDING_APPROVAL: 'doc-status--pending',
    PARTIALLY_APPROVED: 'doc-status--warning',
    APPROVED: 'doc-status--success',
    REJECTED: 'doc-status--danger',
    SENT: 'doc-status--progress',
    ORDERED: 'doc-status--progress',
    SENT_TO_SUPPLIER: 'doc-status--progress',
    PARTIALLY_RECEIVED: 'doc-status--warning',
    RECEIVED: 'doc-status--done',
    CLOSED: 'doc-status--closed',
    CANCELLED: 'doc-status--danger',
  };
  return map[s] ?? 'doc-status--neutral';
}

/** Filas de la tabla meta: contrato y, si aplica, subcontrato (etiquetas explícitas). */
function buildMetaContractRows(order: PoPdfOrder): string {
  const cLine = order.contract
    ? [order.contract.code, order.contract.name]
        .filter(Boolean)
        .join(' — ')
        .trim()
    : '';
  const sLine = order.subcontract
    ? [order.subcontract.code, order.subcontract.name]
        .filter(Boolean)
        .join(' — ')
        .trim()
    : '';
  const rows: string[] = [
    `<tr>
            <td style="width:52px;vertical-align:top;">Contrato</td>
            <td>${escapeHtml(cLine || '—')}</td>
          </tr>`,
  ];
  if (order.subcontract) {
    rows.push(`<tr>
            <td style="vertical-align:top;">Subcontrato</td>
            <td>${escapeHtml(sLine || '—')}</td>
          </tr>`);
  }
  return rows.join('');
}

function equipmentLine(eq: NonNullable<PoPdfOrder['equipment']>): string {
  const label = [eq.brand, eq.model].filter(Boolean).join(' ').trim();
  return label ? `${eq.internalId} (${label})` : eq.internalId;
}

function buildItemDescription(line: PoPdfOrder['items'][0]): string {
  return catalogItemLineLabel({
    partNumber: line.inventoryItem?.partNumber,
    name: line.inventoryItem?.name,
    description: line.inventoryItem?.description,
    lineDescription: line.description,
  });
}

/** Filas vacías al final solo cuando hay pocas líneas (evita segunda página artificial). */
const ITEM_TABLE_EXTRA_EMPTY_ROWS = 5;
/** Con esta cantidad o más de líneas ocupadas no se añaden filas vacías extra. */
const ITEM_TABLE_NO_EXTRA_FROM_OCCUPIED = 10;

function computeItemPaddingRowCount(occupiedCount: number): number {
  if (occupiedCount >= ITEM_TABLE_NO_EXTRA_FROM_OCCUPIED) return 0;
  return ITEM_TABLE_EXTRA_EMPTY_ROWS;
}

function buildPurchaseOrderHtml(
  order: PoPdfOrder,
  options: PoPdfOptions,
): string {
  const tenant = order.tenant;
  const vendor = order.quotation?.vendor;
  const netTotal = Number(order.totalAmount.toString());
  const currency = (order.currency || 'CLP').trim() || 'CLP';
  const isClp = currency.toUpperCase() === 'CLP';
  const iva = isClp ? Math.round(netTotal * 0.19) : 0;
  const gross = isClp ? netTotal + iva : netTotal;

  const rowsHtml = order.items
    .map((line, index) => {
      const qty = Number(line.quantity);
      const unit = Number(line.unitCost.toString());
      const lineTotal = qty * unit;
      return `<tr>
      <td class="c">${index + 1}</td>
      <td class="c">${formatNumberEs(qty, 3)}</td>
      <td class="l">${escapeHtml(buildItemDescription(line))}</td>
      <td class="r">${formatNumberEs(unit)}</td>
      <td class="r">${formatNumberEs(lineTotal)}</td>
    </tr>`;
    })
    .join('');

  const itemCount = order.items.length;
  const padCount = computeItemPaddingRowCount(itemCount);
  const padStart = itemCount;
  const paddingHtml = Array.from({ length: padCount }, (_, i) => {
    const n = padStart + i + 1;
    return `<tr><td class="c">${n}</td><td></td><td></td><td></td><td></td></tr>`;
  }).join('');

  const invoiceName =
    tenant?.invoiceLegalName?.trim() || tenant?.name?.trim() || '—';

  const statusLabelEs = escapeHtml(purchaseOrderStatusLabelEs(order.status));
  const statusBadgeMod = purchaseOrderStatusBadgeMod(order.status);
  const metaContractRowsHtml = buildMetaContractRows(order);

  const destBlock = (() => {
    const hasAsset = !!(order.equipment || order.workOrder);
    if (!hasAsset) {
      return escapeHtml(
        'Destino operativo: gasto general / no asociado a activo u OT.',
      );
    }
    const parts: string[] = [];
    if (order.equipment) {
      parts.push(`Equipo: ${escapeHtml(equipmentLine(order.equipment))}`);
    }
    if (order.workOrder) {
      parts.push(`OT: ${escapeHtml(order.workOrder.correlative)}`);
      const d = order.workOrder.description?.trim();
      if (d) {
        const short = d.length > 180 ? `${d.slice(0, 177)}…` : d;
        parts.push(escapeHtml(short));
      }
    }
    return parts.join('<br/>');
  })();

  const delivery = order.deliveryAddress?.trim();
  const payTermsFromOrder = order.paymentTerms?.trim();
  const payFromQuotation =
    order.quotation?.paymentDays != null
      ? formatPaymentDaysLabel(order.quotation.paymentDays)
      : '';
  const payTermsDisplay = payTermsFromOrder || payFromQuotation || '—';
  const reqCorr = order.requisition?.correlative;
  const warnNoticeHtml = ocPdfLegalNoticeHtml(tenant);

  const logoBlock = options.tenantLogoDataUri
    ? `<img class="logo" src="${options.tenantLogoDataUri}" alt="" />`
    : `<div class="logo-ph">${escapeHtml(tenant?.name?.slice(0, 3).toUpperCase() || 'OC')}</div>`;

  const accent =
    order.tenant?.primaryColor?.trim() &&
    /^#[0-9A-Fa-f]{6}$/.test(order.tenant.primaryColor.trim())
      ? order.tenant.primaryColor.trim()
      : '#0891b2';

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <title>Orden de compra ${escapeHtml(order.correlative)}</title>
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
      margin-bottom: 5px;
    }
    .top-doc {
      flex: 1 1 auto;
      min-width: 0;
      max-width: 56%;
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
    .doc-status--neutral {
      background: #f1f5f9;
      color: #0f172a;
      border-color: #94a3b8;
    }
    .doc-status--pending {
      background: #fffbeb;
      color: #92400e;
      border-color: #fbbf24;
    }
    .doc-status--warning {
      background: #fff7ed;
      color: #9a3412;
      border-color: #fb923c;
    }
    .doc-status--success {
      background: #ecfdf5;
      color: #065f46;
      border-color: #34d399;
    }
    .doc-status--progress {
      background: #f0f9ff;
      color: #0c4a6e;
      border-color: #38bdf8;
    }
    .doc-status--done {
      background: #ecfdf5;
      color: #14532d;
      border-color: #22c55e;
    }
    .doc-status--closed {
      background: #f8fafc;
      color: #334155;
      border-color: #94a3b8;
    }
    .doc-status--danger {
      background: #fef2f2;
      color: #991b1b;
      border-color: #f87171;
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
    .meta { flex: 0 0 42%; width: 42%; min-width: 0; max-width: 42%; }
    table.meta-t { width: 100%; border-collapse: collapse; }
    table.meta-t td, table.meta-t th {
      border: 1px solid #0f172a;
      padding: 3px 5px;
      vertical-align: middle;
    }
    table.meta-t td:first-child {
      font-weight: 700;
      color: #0f172a;
    }
    .addr {
      text-align: center;
      font-size: 8.5px;
      margin: 4px 0 6px;
      line-height: 1.35;
      color: #334155;
    }
    .addr strong {
      font-weight: 700;
      color: #0f172a;
    }
    .warn {
      border: 1px solid #0f172a;
      text-align: center;
      font-weight: 700;
      font-size: 8px;
      padding: 5px 4px;
      line-height: 1.35;
      background: #f8fafc;
    }
    .grid2 { width: 100%; border-collapse: collapse; margin-bottom: 4px; }
    .grid2 td, .grid2 th {
      border: 1px solid #0f172a;
      padding: 3px 5px;
      vertical-align: top;
    }
    .grid2 td.lbl {
      font-weight: 700;
      color: #0f172a;
    }
    .muted { color: #475569; font-size: 8.5px; }
    .items {
      width: 100%;
      table-layout: fixed;
      border-collapse: collapse;
      margin-bottom: 5px;
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
      padding: 2px 3px;
      min-height: 12px;
      vertical-align: top;
    }
    .items td.c { text-align: center; width: 5%; }
    .items td.r { text-align: right; white-space: nowrap; }
    .items td.l {
      text-align: left;
      word-wrap: break-word;
      overflow-wrap: anywhere;
      hyphens: auto;
    }
    .foot {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 8px;
      margin-top: 3px;
    }
    .foot-left { width: 48%; }
    .foot-right { width: 48%; display: flex; flex-direction: column; align-items: flex-end; }
    .totals { width: 100%; max-width: 220px; border-collapse: collapse; }
    .totals td {
      border: 1px solid #0f172a;
      padding: 3px 6px;
    }
    .totals tr > td:first-child {
      font-weight: 700;
      color: #0f172a;
    }
    .totals .r { text-align: right; white-space: nowrap; }
    .totals .b { font-weight: 800; }
    .dest {
      border: 1px solid #64748b;
      background: #f1f5f9;
      padding: 5px 7px;
      border-radius: 3px;
      font-size: 8.5px;
      line-height: 1.35;
      margin-bottom: 5px;
    }
    .foot-note {
      margin-top: 6px;
      font-size: 7.5px;
      color: #64748b;
      line-height: 1.35;
    }
    .foot-req-ref {
      text-align: center;
      font-size: 8.5px;
      line-height: 1.4;
      font-weight: 500;
      color: #0f172a;
    }
    .foot-req-ref strong {
      font-weight: 800;
    }
    .sig {
      margin-top: 6px;
      width: 100%;
      max-width: 220px;
      height: 52px;
      border: 1px solid #0f172a;
      text-align: center;
      font-size: 8px;
      color: #64748b;
      display: flex;
      align-items: center;
      justify-content: center;
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
            <h1>ORDEN DE COMPRA</h1>
            <p class="doc-status ${statusBadgeMod}"><span class="doc-status-k">Estado:</span> ${statusLabelEs}</p>
          </div>
        </div>
      </div>
      <div class="meta">
        <table class="meta-t">
          <tr>
            <td style="width:52px;">Rut</td>
            <td>${escapeHtml(tenant?.rut?.trim() || '—')}</td>
          </tr>
          ${metaContractRowsHtml}
          <tr>
            <td style="width:52px;">Nº</td>
            <td style="font-weight:800;font-size:11px;">${escapeHtml(order.correlative)}</td>
          </tr>
        </table>
        <div class="addr">
          ${tenant?.address?.trim() ? `<strong>Dirección:</strong> ${escapeHtml(tenant.address.trim())}<br/>` : ''}
          ${tenant?.city?.trim() ? `<strong>Ciudad:</strong> ${escapeHtml(tenant.city.trim())}<br/>` : ''}
          ${tenant?.phone?.trim() ? `<strong>Tel.:</strong> ${escapeHtml(tenant.phone.trim())}` : ''}
        </div>
        <div class="warn">
          ${warnNoticeHtml}
        </div>
      </div>
    </div>

    <div class="dest"><strong>Destino / imputación</strong><br/>${destBlock}</div>

    <table class="grid2">
      <tr>
        <td colspan="4" style="text-align:center;font-weight:800;">Emitir factura a nombre de</td>
      </tr>
      <tr>
        <td colspan="4" style="text-align:center;font-weight:800;font-size:11px;">${escapeHtml(invoiceName)}</td>
      </tr>
      <tr>
        <td class="lbl" style="width:64px;">Rut</td>
        <td colspan="3">${escapeHtml(tenant?.rut?.trim() || '—')}</td>
      </tr>
      <tr>
        <td class="lbl">Dirección</td>
        <td colspan="3">${escapeHtml(tenant?.address?.trim() || '—')}</td>
      </tr>
      <tr>
        <td class="lbl">Ciudad</td>
        <td colspan="3">${escapeHtml(tenant?.city?.trim() || '—')}</td>
      </tr>
      <tr>
        <td class="lbl">Fono</td>
        <td style="width:38%;">${escapeHtml(tenant?.phone?.trim() || '—')}</td>
        <td class="lbl" style="width:40px;">Fax</td>
        <td>—</td>
      </tr>
    </table>

    <table class="grid2">
      <tr>
        <td class="lbl" style="width:64px;">Fecha</td>
        <td colspan="3">${escapeHtml(formatLongDate(order.createdAt))}</td>
      </tr>
      <tr>
        <td class="lbl">Razón social</td>
        <td colspan="3">${escapeHtml(vendor?.name?.trim() || '—')}</td>
      </tr>
      <tr>
        <td class="lbl">Rut</td>
        <td>${escapeHtml(vendor?.rut?.trim() || '—')}</td>
        <td class="lbl" style="width:52px;">Fono</td>
        <td>${escapeHtml(vendor?.contactPhone?.trim() || '—')}</td>
      </tr>
      <tr>
        <td class="lbl">Dirección</td>
        <td colspan="3">${escapeHtml(vendor?.address?.trim() || '—')}</td>
      </tr>
      <tr>
        <td class="lbl">Giro</td>
        <td colspan="3">${escapeHtml(vendor?.businessActivity?.trim() || '—')}</td>
      </tr>
      <tr>
        <td class="lbl">Fax</td>
        <td>${escapeHtml(vendor?.fax?.trim() || '—')}</td>
        <td class="lbl">Ciudad</td>
        <td>${escapeHtml(vendor?.city?.trim() || '—')}</td>
      </tr>
      <tr>
        <td class="lbl">Cond. pago</td>
        <td colspan="3">${escapeHtml(payTermsDisplay)}</td>
      </tr>
      <tr>
        <td class="lbl">Entrega</td>
        <td colspan="3">${escapeHtml(delivery || '—')}</td>
      </tr>
      <tr>
        <td class="lbl">Correo</td>
        <td colspan="2">${escapeHtml(vendor?.contactEmail?.trim() || '—')}</td>
        <td><strong>Cód.</strong> ${escapeHtml(vendor?.code?.trim() || '—')}</td>
      </tr>
    </table>

    <table class="items">
      <colgroup>
        <col style="width:5%;" />
        <col style="width:11%;" />
        <col style="width:48%;" />
        <col style="width:18%;" />
        <col style="width:18%;" />
      </colgroup>
      <thead>
        <tr>
          <th>Ítem</th>
          <th>Cantidad</th>
          <th>Descripción elementos o detalle</th>
          <th>P. unitario</th>
          <th>Valor total</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
        ${paddingHtml}
      </tbody>
    </table>

    <div class="foot">
      <div class="foot-left">
        <table class="grid2" style="margin:0;">
          <tr>
            <td colspan="2" class="foot-req-ref">
              Según requerimiento Nº <strong>${escapeHtml(reqCorr || '—')}</strong> del sistema EAM BaseLogic
            </td>
          </tr>
          ${
            order.subcontract
              ? `<tr>
            <td class="lbl">Subcontrato</td>
            <td>${escapeHtml(
              [order.subcontract.code, order.subcontract.name]
                .filter(Boolean)
                .join(' ')
                .trim(),
            )}</td>
          </tr>`
              : ''
          }
        </table>
        ${
          order.notes?.trim()
            ? `<p class="foot-note"><strong>Notas:</strong> ${escapeHtml(order.notes.trim())}</p>`
            : ''
        }
      </div>
      <div class="foot-right">
        <table class="totals">
          <tr>
            <td>Subtotal / total neto (${escapeHtml(currency)})</td>
            <td colspan="2" class="r">${formatNumberEs(netTotal)}</td>
          </tr>
          <tr>
            <td>Exento</td>
            <td colspan="2" class="r">—</td>
          </tr>
          <tr>
            <td>I.V.A. ${isClp ? '(19% ref.)' : ''}</td>
            <td style="text-align:center;width:36px;">${isClp ? '19%' : '—'}</td>
            <td class="r">${isClp ? formatNumberEs(iva) : '—'}</td>
          </tr>
          <tr>
            <td class="b">Valor total ${isClp ? 'con IVA ref.' : ''}</td>
            <td colspan="2" class="r b">${isClp ? formatNumberEs(gross) : formatNumberEs(netTotal)}</td>
          </tr>
        </table>
        <div class="sig">Firma autorizada / timbre empresa</div>
      </div>
    </div>

    ${pdfElectronicFootNoteHtml([order.correlative, currency])}
  </div>
</body>
</html>`;
}

/**
 * PDF formal de OC (HTML + Chromium). Mejor fidelidad tipográfica y tablas que PDFKit plano.
 */
export async function generatePurchaseOrderPdfBuffer(
  order: PoPdfOrder,
  options: PoPdfOptions = {},
): Promise<Buffer> {
  const html = buildPurchaseOrderHtml(order, options);
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
