/**
 * Plantillas HTML transaccionales TPM / BaseLogic (estilo industrial oscuro + acento cyan).
 * Contenido dinámico: siempre pasar por escapeHtml().
 */

const BG_PAGE = '#0f1419';
const BG_CARD = '#0a0f14';
const BORDER = '#2a3441';
const ACCENT = '#00e5ff';
const TEXT_MAIN = '#e4e4e7';
const TEXT_MUTED = '#94a3b8';

/** Escapa texto para inserción en HTML (nombres, roles, ciudades, etc.). */
export function escapeHtml(s: string | null | undefined): string {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Pie de firma corporativo (BaseLogic / TPM). */
export function getSystemEmailSignatureHtml(): string {
  return `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:580px;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
  <tr>
    <td style="background-color:${BG_CARD};padding:24px 22px;border-radius:0 12px 12px 0;border-left:4px solid ${ACCENT};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
        <tr>
          <td style="padding-right:18px;text-align:center;border-right:1px solid ${BORDER};width:120px;vertical-align:middle;">
            <img src="https://baselogic.cl/BaseLogic%20LogoV2.png?v=5" alt="BaseLogic" width="120" style="display:block;width:120px;height:auto;border:0;outline:none;margin:0 auto;" />
          </td>
          <td style="padding-left:18px;vertical-align:middle;">
            <p style="margin:0 0 4px 0;font-size:11px;font-family:Consolas,Monaco,monospace;letter-spacing:0.18em;text-transform:uppercase;color:${ACCENT};">BaseLogic · TPM</p>
            <h2 style="margin:0 0 6px 0;padding:0;font-size:17px;color:#ffffff;font-weight:700;letter-spacing:0.3px;">Gestión de activos industriales</h2>
            <p style="margin:0 0 14px 0;font-size:12px;color:${TEXT_MUTED};line-height:1.45;">Correo automático del sistema EAM / ERP multicontrato. No responda a este mensaje.</p>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="font-size:13px;color:${TEXT_MAIN};line-height:1.75;">
              <tr>
                <td style="width:22px;vertical-align:top;"><img src="https://baselogic.cl/icon-mail.png?v=5" alt="" width="14" height="14" style="display:block;border:0;margin-top:3px;" /></td>
                <td style="padding-left:8px;"><a href="mailto:contacto@baselogic.cl" style="color:${TEXT_MAIN};text-decoration:none;">contacto@baselogic.cl</a></td>
              </tr>
              <tr>
                <td style="width:22px;vertical-align:top;padding-top:4px;"><img src="https://baselogic.cl/icon-web.png?v=5" alt="" width="16" height="16" style="display:block;border:0;margin-top:3px;" /></td>
                <td style="padding-left:8px;padding-top:4px;"><a href="https://baselogic.cl" style="color:${ACCENT};text-decoration:none;font-weight:500;">baselogic.cl</a></td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`;
}

export type TpmEmailOptions = {
  /** Título principal del cuerpo */
  headline: string;
  /** Línea opcional bajo el kicker (ej. rol o resumen) */
  subhead?: string;
  /** HTML seguro del bloque principal (párrafos, listas) */
  bodyHtml: string;
  /** Botón CTA opcional */
  cta?: { href: string; label: string };
  /** Nota pequeña bajo el CTA (HTML seguro) */
  footnoteHtml?: string;
};

/**
 * Documento completo: contenedor oscuro + tarjeta + pie de firma.
 */
export function buildTpmEmailHtml(opts: TpmEmailOptions): string {
  const ctaBlock = opts.cta
    ? `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 20px 0;">
      <tr>
        <td align="left">
          <a href="${opts.cta.href}" style="display:inline-block;padding:12px 26px;background-color:${ACCENT};color:#0f1419;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;font-weight:700;text-decoration:none;border-radius:10px;letter-spacing:0.02em;">${escapeHtml(opts.cta.label)}</a>
        </td>
      </tr>
    </table>`
    : '';

  const footnote = opts.footnoteHtml
    ? `<p style="margin:16px 0 0 0;font-size:12px;line-height:1.5;color:${TEXT_MUTED};">${opts.footnoteHtml}</p>`
    : '';

  const sub = opts.subhead
    ? `<p style="margin:0 0 20px 0;font-size:14px;line-height:1.55;color:${TEXT_MUTED};">${escapeHtml(opts.subhead)}</p>`
    : '';

  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background-color:${BG_PAGE};">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:${BG_PAGE};padding:28px 12px;">
  <tr>
    <td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="580" style="max-width:580px;width:100%;">
        <tr>
          <td style="background-color:${BG_CARD};border:1px solid ${BORDER};border-left:4px solid ${ACCENT};border-radius:12px;padding:30px 26px 28px 26px;">
            <p style="margin:0 0 10px 0;font-size:10px;font-family:Consolas,Monaco,monospace;letter-spacing:0.22em;text-transform:uppercase;color:${ACCENT};">BaseLogic</p>
            <h1 style="margin:0 0 12px 0;font-size:20px;font-weight:700;color:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.25;">${escapeHtml(opts.headline)}</h1>
            ${sub}
            <div style="font-size:14px;line-height:1.6;color:${TEXT_MAIN};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
            ${opts.bodyHtml}
            </div>
            ${ctaBlock}
            ${footnote}
          </td>
        </tr>
        <tr>
          <td style="padding-top:22px;padding-bottom:8px;">
            ${getSystemEmailSignatureHtml()}
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}
