import { chromium } from 'playwright';

/** Marca en pie de página de documentos PDF del EAM. */
export const PDF_PRODUCT_FOOTER = 'BaseLogic-EAM';

/** Texto seguro para HTML/PDF; acepta null/undefined. */
export function escapeHtml(s: string | null | undefined): string {
  const raw = s == null ? '' : String(s);
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function formatNumberEs(n: number, maxFrac = 2): string {
  if (!Number.isFinite(n)) return '—';
  try {
    return n.toLocaleString('es-CL', {
      minimumFractionDigits: 0,
      maximumFractionDigits: maxFrac,
    });
  } catch {
    return String(n);
  }
}

export function formatLongDate(d: Date): string {
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

export function formatDateTimeEs(d: Date): string {
  try {
    return new Intl.DateTimeFormat('es-CL', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(d);
  } catch {
    return d.toISOString();
  }
}

export function resolveTenantAccent(primaryColor?: string | null): string {
  const c = primaryColor?.trim();
  return c && /^#[0-9A-Fa-f]{6}$/.test(c) ? c : '#0891b2';
}

export function formatClp(n: number, maxFrac = 0): string {
  if (!Number.isFinite(n)) return '—';
  try {
    return `$ ${n.toLocaleString('es-CL', {
      minimumFractionDigits: 0,
      maximumFractionDigits: maxFrac,
    })}`;
  } catch {
    return `$ ${n}`;
  }
}

/** Pie estándar: «Documento generado electrónicamente desde BaseLogic-EAM · …». */
export function pdfElectronicFootNoteHtml(extraParts: string[]): string {
  const parts = [
    `Documento generado electrónicamente desde ${PDF_PRODUCT_FOOTER}`,
    ...extraParts.filter((p) => p.trim().length > 0),
    formatDateTimeEs(new Date()),
  ];
  return `<p class="foot-note">${parts.map((p) => escapeHtml(p)).join(' · ')}</p>`;
}

export function buildLogoBlockHtml(
  tenantName: string | undefined | null,
  tenantLogoDataUri?: string | null,
  placeholderFallback = 'BL',
): string {
  if (tenantLogoDataUri) {
    return `<img class="logo" src="${tenantLogoDataUri}" alt="" />`;
  }
  const initials =
    tenantName?.trim().slice(0, 3).toUpperCase() || placeholderFallback;
  return `<div class="logo-ph">${escapeHtml(initials)}</div>`;
}

export type RenderHtmlToPdfOptions = {
  landscape?: boolean;
};

export const PDF_DOC_STATUS_CSS = `
    .doc-status--caption {
      background: #f0f9ff;
      color: #0c4a6e;
      border-color: #7dd3fc;
      font-weight: 600;
      font-size: 10px;
    }
    .doc-status--caption .doc-status-k { color: #075985; }
    .kpi-row {
      display: flex;
      gap: 8px;
      margin-bottom: 8px;
      flex-wrap: wrap;
    }
    .kpi-box {
      flex: 1 1 30%;
      min-width: 120px;
      border: 1px solid #0f172a;
      border-radius: 4px;
      padding: 6px 8px;
      background: #f8fafc;
    }
    .kpi-box .kpi-t {
      font-size: 8px;
      font-weight: 700;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      margin-bottom: 4px;
    }
    .kpi-box .kpi-v {
      font-size: 11px;
      font-weight: 800;
      color: #0f172a;
    }
    .page-break { page-break-before: always; }
    .qty-line {
      border-bottom: 1px solid #64748b;
      min-height: 14px;
    }
`;

/** Estilos base compartidos (cabecera, meta, grid2, items, badges). */
export function buildPdfDocumentBaseCss(accent: string): string {
  return `
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
    .doc-status--neutral { background: #f1f5f9; color: #0f172a; border-color: #94a3b8; }
    .doc-status--pending { background: #fffbeb; color: #92400e; border-color: #fbbf24; }
    .doc-status--warning { background: #fff7ed; color: #9a3412; border-color: #fb923c; }
    .doc-status--success { background: #ecfdf5; color: #065f46; border-color: #34d399; }
    .doc-status--progress { background: #f0f9ff; color: #0c4a6e; border-color: #38bdf8; }
    .doc-status--done { background: #ecfdf5; color: #14532d; border-color: #22c55e; }
    .doc-status--closed { background: #f8fafc; color: #334155; border-color: #94a3b8; }
    .doc-status--danger { background: #fef2f2; color: #991b1b; border-color: #f87171; }
    .logo-corner { flex: 0 0 auto; text-align: left; }
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
      padding: 4px 8px;
    }
    .meta { flex: 0 0 42%; width: 42%; min-width: 0; max-width: 42%; }
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
    .section-title {
      margin: 10px 0 4px;
      font-size: 10px;
      font-weight: 800;
      color: #0f172a;
      letter-spacing: 0.03em;
      text-transform: uppercase;
    }
    .dest {
      border: 1px solid #64748b;
      background: #f1f5f9;
      padding: 6px 8px;
      border-radius: 3px;
      font-size: 8.5px;
      line-height: 1.4;
      margin-bottom: 6px;
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
      width: 88px;
    }
    .muted { color: #475569; font-size: 8.5px; }
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
    .narrative {
      border: 1px solid #0f172a;
      padding: 6px 8px;
      margin-bottom: 6px;
      font-size: 9px;
      line-height: 1.45;
      white-space: pre-wrap;
    }
    .narrative .lbl-inline {
      display: block;
      font-weight: 800;
      color: #0f172a;
      margin-bottom: 2px;
      font-size: 8.5px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .tag-list { margin: 0; padding: 0; list-style: none; }
    .tag-list li {
      display: inline-block;
      margin: 0 4px 4px 0;
      padding: 2px 6px;
      border: 1px solid #94a3b8;
      border-radius: 3px;
      font-size: 8px;
      font-weight: 600;
      background: #f8fafc;
    }
    .foot-sigs {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      margin-top: 14px;
    }
    .sig-box {
      flex: 1;
      max-width: 48%;
      border: 1px solid #0f172a;
      min-height: 56px;
      padding: 6px 8px;
      font-size: 8px;
      color: #334155;
    }
    .sig-box .sig-title {
      font-weight: 800;
      color: #0f172a;
      margin-bottom: 4px;
      font-size: 8.5px;
      text-transform: uppercase;
    }
    .foot-note {
      margin-top: 8px;
      font-size: 7.5px;
      color: #64748b;
      line-height: 1.35;
      text-align: center;
    }
  `;
}

export async function renderHtmlToPdfBuffer(
  html: string,
  options: RenderHtmlToPdfOptions = {},
): Promise<Buffer> {
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
        landscape: options.landscape === true,
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
