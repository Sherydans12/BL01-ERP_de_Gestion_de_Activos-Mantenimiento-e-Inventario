import { chromium } from 'playwright';

/**
 * PDF de resumen de requerimiento (SRC) — HTML + Chromium.
 * Patrón: `docs/agentes/pdf-html-playwright-plantilla-base.md`.
 */

export type SrcPdfRequisition = {
  correlative: string;
  status: string;
  description: string;
  justification?: string | null;
  createdAt: Date;
  contract?: { code?: string | null; name?: string | null } | null;
  subcontract?: { code?: string | null; name?: string | null } | null;
  requestedBy?: { name?: string | null; email?: string | null } | null;
  tenant?: {
    name: string;
    rut?: string | null;
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
    unitOfMeasure: string;
    partNumber?: string | null;
    itemNotes?: string | null;
    inventoryItem?: { partNumber?: string | null; name?: string | null } | null;
    awardedQuotationItem?: {
      unitPrice: unknown;
      quotation?: {
        currency?: string | null;
        vendor?: { name?: string | null } | null;
      } | null;
    } | null;
  }>;
  quotations?: Array<{
    isWinner?: boolean;
    vendor?: { name?: string | null } | null;
  }>;
  purchaseOrders?: Array<{
    status?: string;
    correlative?: string | null;
    totalAmount: unknown;
    currency?: string | null;
  }>;
};

export type SrcPdfOptions = {
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

function formatNumberEs(n: number, maxFrac = 3): string {
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

function requisitionStatusLabelEs(status: string | undefined | null): string {
  const s = (status || '').trim().toUpperCase();
  const map: Record<string, string> = {
    DRAFT: 'Borrador',
    SUBMITTED: 'Enviado',
    QUOTING: 'En cotización',
    PENDING_APPROVAL: 'Pendiente de aprobación',
    PARTIALLY_PURCHASED: 'Compra parcial',
    APPROVED: 'Aprobado',
    REJECTED: 'Rechazado',
    CANCELLED: 'Cancelado',
    CLOSED: 'Cerrado (completo)',
  };
  return map[s] || escapeHtml(s || '—');
}

/** Modificador de estilo para badge de estado SRC en cabecera PDF. */
function requisitionStatusBadgeMod(status: string | undefined | null): string {
  const s = (status || '').trim().toUpperCase();
  const map: Record<string, string> = {
    DRAFT: 'doc-status--neutral',
    SUBMITTED: 'doc-status--progress',
    QUOTING: 'doc-status--progress',
    PENDING_APPROVAL: 'doc-status--pending',
    PARTIALLY_PURCHASED: 'doc-status--warning',
    APPROVED: 'doc-status--success',
    REJECTED: 'doc-status--danger',
    CANCELLED: 'doc-status--danger',
    CLOSED: 'doc-status--closed',
  };
  return map[s] ?? 'doc-status--neutral';
}

function equipmentLine(
  eq: NonNullable<SrcPdfRequisition['equipment']>,
): string {
  const label = [eq.brand, eq.model].filter(Boolean).join(' ').trim();
  return label ? `${eq.internalId} (${label})` : eq.internalId;
}

function buildItemRowDescription(
  line: SrcPdfRequisition['items'][0],
): string {
  const part = line.inventoryItem?.partNumber?.trim() || line.partNumber?.trim();
  const name = line.inventoryItem?.name?.trim();
  const base = line.description?.trim() || '—';
  if (part && name) return `COD (${part}) ${name} — ${base}`;
  if (part) return `COD (${part}) ${base}`;
  if (name) return `${name} — ${base}`;
  return base;
}

const PO_INACTIVE = new Set(['CANCELLED', 'REJECTED']);

function computeModalidadHtml(req: SrcPdfRequisition): string {
  const activePos = (req.purchaseOrders ?? []).filter(
    (po) => po.status && !PO_INACTIVE.has(String(po.status)),
  );
  const vendorNamesFromAwards = new Set<string>();
  for (const it of req.items ?? []) {
    const n = it.awardedQuotationItem?.quotation?.vendor?.name?.trim();
    if (n) vendorNamesFromAwards.add(n);
  }
  const hasWinner = (req.quotations ?? []).some((q) => q.isWinner);
  const winnerVendor = (req.quotations ?? []).find((q) => q.isWinner)?.vendor
    ?.name;

  const isFragmented =
    activePos.length > 1 ||
    vendorNamesFromAwards.size > 1 ||
    ((req.items ?? []).some((i) => !!i.awardedQuotationItem) &&
      !hasWinner &&
      (req.quotations?.length ?? 0) > 0);

  if (isFragmented) {
    const parts = [...vendorNamesFromAwards].sort();
    const vendorLine =
      parts.length > 0
        ? `Proveedores según adjudicación por ítem (no hay un único proveedor para el total del requerimiento): ${parts.join('; ')}.`
        : 'Las adjudicaciones por ítem y las órdenes de compra asociadas constan en el detalle del sistema; no corresponde un único proveedor global para el total del SRC.';
    return `<p class="modalidad-title">Modalidad: compra fragmentada (multiproveedor)</p><p>${escapeHtml(vendorLine)}</p>`;
  }
  if (winnerVendor?.trim()) {
    return `<p><strong>Proveedor de referencia (cotización ganadora):</strong> ${escapeHtml(winnerVendor.trim())}</p>`;
  }
  if (vendorNamesFromAwards.size === 1) {
    const v = [...vendorNamesFromAwards][0]!;
    return `<p><strong>Proveedor adjudicado (oferta por ítem):</strong> ${escapeHtml(v)}</p>`;
  }
  return `<p>${escapeHtml('Sin adjudicación definitiva al momento de la emisión (en proceso o pendiente de ofertas).')}</p>`;
}

function buildPurchaseRequisitionHtml(
  req: SrcPdfRequisition,
  options: SrcPdfOptions,
): string {
  const tenant = req.tenant;
  const accent =
    tenant?.primaryColor?.trim() &&
    /^#[0-9A-Fa-f]{6}$/.test(tenant.primaryColor.trim())
      ? tenant.primaryColor.trim()
      : '#0891b2';

  const logoBlock = options.tenantLogoDataUri
    ? `<img class="logo" src="${options.tenantLogoDataUri}" alt="" />`
    : `<div class="logo-ph">${escapeHtml(tenant?.name?.slice(0, 3).toUpperCase() || 'SRC')}</div>`;

  const cLine = req.contract
    ? [req.contract.code, req.contract.name].filter(Boolean).join(' — ').trim()
    : '';
  const sLine = req.subcontract
    ? [req.subcontract.code, req.subcontract.name].filter(Boolean).join(' — ').trim()
    : '';

  const destImputacion = (() => {
    const hasAsset = !!(req.equipment || req.workOrder);
    if (!hasAsset) {
      return escapeHtml(
        'Imputación: gasto general / no asociado a activo u OT en este resumen.',
      );
    }
    const parts: string[] = [];
    if (req.equipment) {
      parts.push(`Equipo: ${escapeHtml(equipmentLine(req.equipment))}`);
    }
    if (req.workOrder) {
      parts.push(`OT: ${escapeHtml(req.workOrder.correlative)}`);
      const d = req.workOrder.description?.trim();
      if (d) {
        const short = d.length > 180 ? `${d.slice(0, 177)}…` : d;
        parts.push(escapeHtml(short));
      }
    }
    return parts.join('<br/>');
  })();

  const requesterLine = [req.requestedBy?.name?.trim(), req.requestedBy?.email?.trim()]
    .filter(Boolean)
    .join(' · ');

  const statusReqBadgeMod = requisitionStatusBadgeMod(req.status);

  const activePos = (req.purchaseOrders ?? []).filter(
    (po) => po.status && !PO_INACTIVE.has(String(po.status)),
  );

  const poRows =
    activePos.length > 0
      ? activePos
          .map(
            (po) => `<tr>
          <td class="c">${escapeHtml(String(po.correlative ?? '—'))}</td>
          <td class="c">${escapeHtml(String(po.status ?? '—'))}</td>
          <td class="r">${escapeHtml(formatNumberEs(Number(po.totalAmount)))}</td>
          <td class="c">${escapeHtml(String(po.currency ?? '').trim() || '—')}</td>
        </tr>`,
          )
          .join('')
      : '';

  const itemRows = (req.items ?? [])
    .map((it) => {
      const qty = Number(it.quantity);
      const pu = it.awardedQuotationItem?.unitPrice;
      const cur = it.awardedQuotationItem?.quotation?.currency ?? '';
      const puStr =
        pu != null && cur
          ? `${formatNumberEs(Number(pu))} ${escapeHtml(cur)}`
          : pu != null
            ? escapeHtml(formatNumberEs(Number(pu)))
            : '—';
      const pv =
        it.awardedQuotationItem?.quotation?.vendor?.name?.trim() || '—';
      const notes = it.itemNotes?.trim();
      const desc = escapeHtml(buildItemRowDescription(it));
      const noteHtml = notes
        ? `<br/><span class="muted">${escapeHtml(notes)}</span>`
        : '';
      return `<tr>
        <td class="l">${desc}${noteHtml}</td>
        <td class="c">${escapeHtml(formatNumberEs(qty, 3))}</td>
        <td class="c">${escapeHtml(it.unitOfMeasure)}</td>
        <td class="r">${puStr}</td>
        <td class="l">${escapeHtml(pv)}</td>
      </tr>`;
    })
    .join('');

  const justificationBlock = req.justification?.trim()
    ? `<table class="grid2" style="margin-top:6px;">
      <tr><td class="lbl" style="width:88px;">Justificación</td><td>${escapeHtml(req.justification.trim())}</td></tr>
    </table>`
    : '';

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <title>Requerimiento ${escapeHtml(req.correlative)}</title>
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
      margin-bottom: 6px;
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
      font-size: 12px;
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
    .meta { flex: 0 0 40%; width: 40%; min-width: 0; max-width: 40%; }
    table.meta-t { width: 100%; border-collapse: collapse; }
    table.meta-t td {
      border: 1px solid #0f172a;
      padding: 3px 5px;
      vertical-align: middle;
    }
    table.meta-t td:first-child {
      font-weight: 700;
      color: #0f172a;
      width: 52px;
    }
    .muted { color: #475569; font-size: 8.5px; }
    .dest {
      border: 1px solid #64748b;
      background: #f1f5f9;
      padding: 6px 8px;
      border-radius: 3px;
      font-size: 8.5px;
      line-height: 1.4;
      margin-bottom: 6px;
    }
    .dest .modalidad-title {
      margin: 0 0 4px;
      font-weight: 800;
      color: #0f172a;
    }
    .grid2 { width: 100%; border-collapse: collapse; margin-bottom: 5px; }
    .grid2 td, .grid2 th {
      border: 1px solid #0f172a;
      padding: 3px 5px;
      vertical-align: top;
    }
    .grid2 td.lbl {
      font-weight: 700;
      color: #0f172a;
    }
    .items {
      width: 100%;
      table-layout: fixed;
      border-collapse: collapse;
      margin-bottom: 6px;
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
    }
    .items td.c { text-align: center; }
    .items td.r { text-align: right; white-space: nowrap; }
    .items td.l {
      text-align: left;
      word-wrap: break-word;
      overflow-wrap: anywhere;
    }
    .foot-note {
      margin-top: 8px;
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
            <h1>REQUERIMIENTO DE COMPRA (SRC)</h1>
            <p class="doc-status ${statusReqBadgeMod}"><span class="doc-status-k">Estado:</span> ${requisitionStatusLabelEs(req.status)}</p>
          </div>
        </div>
      </div>
      <div class="meta">
        <table class="meta-t">
          <tr>
            <td>Nº SRC</td>
            <td style="font-weight:800;font-size:11px;">${escapeHtml(req.correlative)}</td>
          </tr>
          <tr>
            <td>Emisión</td>
            <td>${escapeHtml(formatLongDate(req.createdAt))}</td>
          </tr>
          <tr>
            <td>Contrato</td>
            <td>${escapeHtml(cLine || '—')}</td>
          </tr>
          ${
            req.subcontract
              ? `<tr>
            <td>Subcontrato</td>
            <td>${escapeHtml(sLine || '—')}</td>
          </tr>`
              : ''
          }
          <tr>
            <td>Solicitante</td>
            <td>${escapeHtml(requesterLine || '—')}</td>
          </tr>
          <tr>
            <td>Organización</td>
            <td>${escapeHtml(tenant?.name?.trim() || '—')}</td>
          </tr>
          <tr>
            <td>Rut</td>
            <td>${escapeHtml(tenant?.rut?.trim() || '—')}</td>
          </tr>
        </table>
      </div>
    </div>

    <div class="dest"><strong>Modalidad / proveedores</strong><br/>${computeModalidadHtml(req)}</div>

    <div class="dest"><strong>Destino / imputación</strong><br/>${destImputacion}</div>

    <table class="grid2">
      <tr>
        <td class="lbl" style="width:88px;">Descripción</td>
        <td>${escapeHtml(req.description?.trim() || '—')}</td>
      </tr>
    </table>
    ${justificationBlock}

    ${
      activePos.length > 0
        ? `<p style="margin:8px 0 4px;font-weight:800;color:#0f172a;font-size:10px;">Órdenes de compra vinculadas (referencia)</p>
    <table class="items">
      <colgroup>
        <col style="width:18%;" />
        <col style="width:22%;" />
        <col style="width:30%;" />
        <col style="width:15%;" />
      </colgroup>
      <thead>
        <tr>
          <th>OC</th>
          <th>Estado</th>
          <th>Monto total</th>
          <th>Moneda</th>
        </tr>
      </thead>
      <tbody>${poRows}</tbody>
    </table>`
        : ''
    }

    <p style="margin:8px 0 4px;font-weight:800;color:#0f172a;font-size:10px;">Líneas del requerimiento</p>
    <table class="items">
      <colgroup>
        <col style="width:40%;" />
        <col style="width:10%;" />
        <col style="width:8%;" />
        <col style="width:16%;" />
        <col style="width:26%;" />
      </colgroup>
      <thead>
        <tr>
          <th>Ítem</th>
          <th>Cant.</th>
          <th>Ud.</th>
          <th>P. unit. ref.</th>
          <th>Proveedor ítem</th>
        </tr>
      </thead>
      <tbody>${itemRows}</tbody>
    </table>

    <p class="foot-note">
      Documento generado electrónicamente desde TPM · SRC ${escapeHtml(req.correlative)} · resumen para archivo y auditoría
    </p>
  </div>
</body>
</html>`;
}

export async function generatePurchaseRequisitionPdfBuffer(
  req: SrcPdfRequisition,
  options: SrcPdfOptions = {},
): Promise<Buffer> {
  const html = buildPurchaseRequisitionHtml(req, options);
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
