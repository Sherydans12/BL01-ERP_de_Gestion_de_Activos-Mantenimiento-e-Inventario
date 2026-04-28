import { buildTpmEmailHtml, escapeHtml } from './email-templates';

export function buildMailInviteUser(params: {
  name: string;
  role: string;
  activationLink: string;
}): string {
  return buildTpmEmailHtml({
    headline: 'Bienvenido a TPM',
    subhead:
      'Gestión de activos, mantenimiento e inventario — acceso por invitación.',
    bodyHtml: `
            <p style="margin:0 0 12px 0;">Hola <strong>${escapeHtml(params.name)}</strong>,</p>
            <p style="margin:0 0 12px 0;">Has sido invitado al sistema con el rol de <strong>${escapeHtml(String(params.role))}</strong>.</p>
            <p style="margin:0;">Para activar tu cuenta y definir tu contraseña de forma segura, usa el botón siguiente. El enlace es personal; no lo reenvíes.</p>
            `,
    cta: { href: params.activationLink, label: 'Activar cuenta' },
    footnoteHtml: `Si el botón no abre, copia y pega esta URL en el navegador:<br/><span style="word-break:break-all;color:#94a3b8;font-size:12px;">${escapeHtml(params.activationLink)}</span>`,
  });
}

export function buildMailResendActivation(params: {
  name: string;
  role: string;
  activationLink: string;
}): string {
  return buildTpmEmailHtml({
    headline: 'Reenvío de invitación',
    subhead: 'Activa tu usuario y define tu contraseña.',
    bodyHtml: `
          <p style="margin:0 0 12px 0;">Hola <strong>${escapeHtml(params.name)}</strong>,</p>
          <p style="margin:0 0 12px 0;">Se solicitó reenviar tu invitación para el rol de <strong>${escapeHtml(String(params.role))}</strong>.</p>
          <p style="margin:0;">Usa el botón para completar la activación. Si ya activaste la cuenta, ignora este correo e inicia sesión en la app.</p>
          `,
    cta: { href: params.activationLink, label: 'Activar cuenta' },
    footnoteHtml: `Enlace directo (por si el botón falla):<br/><span style="word-break:break-all;color:#94a3b8;font-size:12px;">${escapeHtml(params.activationLink)}</span>`,
  });
}

/**
 * “Olvidé mi contraseña” — plantilla completa (mismo diseño que invitación / firma).
 */
export function buildMailForgotPassword(params: {
  name: string;
  resetLink: string;
}): string {
  return buildTpmEmailHtml({
    headline: 'Recupera el acceso a tu cuenta',
    subhead: 'Enlace de un solo uso, válido por 1 hora por seguridad.',
    bodyHtml: `
            <p style="margin:0 0 12px 0;">Hola <strong>${escapeHtml(params.name)}</strong>,</p>
            <p style="margin:0 0 12px 0;">Recibimos una solicitud para <strong>definir una nueva contraseña</strong> en <strong>TPM</strong>. Usa el botón siguiente; no es necesario responder a este correo.</p>
            <p style="margin:0 0 16px 0;">Si tú no realizaste esta solicitud, <strong>ignora este mensaje</strong> — tu clave actual no se modificará mientras no completes el enlace.</p>
            <p style="margin:0;padding:12px 14px;border-radius:8px;background-color:#0f1419;border:1px solid #2a3441;border-left:3px solid #00e5ff;font-size:13px;line-height:1.55;color:#94a3b8;">Cuando caduque el enlace, vuelve a <strong style="color:#e4e4e7;">Inicio de sesión → ¿Olvidaste tu contraseña?</strong> y solicita uno nuevo.</p>
            `,
    cta: { href: params.resetLink, label: 'Restablecer contraseña' },
    footnoteHtml: `Enlace de respaldo (copiar y pegar en el navegador):<br/><span style="word-break:break-all;color:#94a3b8;font-size:12px;">${escapeHtml(params.resetLink)}</span>`,
  });
}

export function buildMailUnusualLogin(params: {
  name: string;
  deviceLabel: string;
  ip: string;
  locationLine: string;
}): string {
  return buildTpmEmailHtml({
    headline: 'Acceso inusual en tu cuenta',
    subhead: 'La última sesión no coincide con tu ubicación o red habitual.',
    bodyHtml: `
            <p style="margin:0 0 14px 0;">Hola <strong>${escapeHtml(params.name)}</strong>,</p>
            <p style="margin:0 0 14px 0;">Se registró un inicio de sesión en <strong>TPM</strong> con señales distintas a las de tu acceso anterior (red, dispositivo o ubicación aproximada).</p>
            <p style="margin:0 0 6px 0;padding:12px 14px;border-radius:8px;background-color:#0f1419;border:1px solid #2a3441;font-size:13px;line-height:1.6;">
              <span style="color:#94a3b8;display:block;margin-bottom:6px;">Detalle</span>
              <strong style="color:#e4e4e7;">Dispositivo</strong><br/>
              <span style="color:#e4e4e7;">${escapeHtml(params.deviceLabel)}</span>
            </p>
            <p style="margin:8px 0 6px 0;padding:12px 14px;border-radius:8px;background-color:#0f1419;border:1px solid #2a3441;font-size:13px;line-height:1.6;">
              <strong style="color:#e4e4e7;">Dirección IP</strong><br/>
              <span style="color:#e4e4e7;">${escapeHtml(params.ip || '—')}</span>
            </p>
            <p style="margin:8px 0 0 0;padding:12px 14px;border-radius:8px;background-color:#0f1419;border:1px solid #2a3441;font-size:13px;line-height:1.6;">
              <strong style="color:#e4e4e7;">Ubicación (aprox.)</strong><br/>
              <span style="color:#e4e4e7;">${escapeHtml(params.locationLine || '—')}</span>
            </p>
            <p style="margin:16px 0 0 0;">Si no fuiste tú, cambia tu contraseña y, en <strong>Mi cuenta → Seguridad</strong>, usa <strong>Cerrar todas las demás sesiones</strong>.</p>
            `,
  });
}
