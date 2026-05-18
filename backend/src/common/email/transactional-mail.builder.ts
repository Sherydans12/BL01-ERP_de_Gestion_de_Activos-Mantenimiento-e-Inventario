import { buildTpmEmailHtml, escapeHtml } from './email-templates';

export function buildMailInviteUser(params: {
  name: string;
  role: string;
  activationLink: string;
  /** Ej. "Empresa X — código TPM" para contexto multi-tenant. */
  organizationLine?: string;
}): string {
  const orgBlock = params.organizationLine
    ? `<p style="margin:0 0 12px 0;padding:12px 14px;border-radius:8px;background-color:#0f1419;border:1px solid #2a3441;font-size:13px;line-height:1.55;color:#94a3b8;"><strong style="color:#e4e4e7;">Organización</strong><br/><span style="color:#e4e4e7;">${escapeHtml(params.organizationLine)}</span></p>`
    : '';
  return buildTpmEmailHtml({
    headline: 'Bienvenido a TPM',
    subhead:
      'Gestión de activos, mantenimiento e inventario — acceso por invitación.',
    bodyHtml: `
            <p style="margin:0 0 12px 0;">Hola <strong>${escapeHtml(params.name)}</strong>,</p>
            ${orgBlock}
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
  organizationLine?: string;
}): string {
  const orgBlock = params.organizationLine
    ? `<p style="margin:0 0 12px 0;padding:12px 14px;border-radius:8px;background-color:#0f1419;border:1px solid #2a3441;font-size:13px;line-height:1.55;color:#94a3b8;"><strong style="color:#e4e4e7;">Organización</strong><br/><span style="color:#e4e4e7;">${escapeHtml(params.organizationLine)}</span></p>`
    : '';
  return buildTpmEmailHtml({
    headline: 'Reenvío de invitación',
    subhead: 'Activa tu usuario y define tu contraseña.',
    bodyHtml: `
          <p style="margin:0 0 12px 0;">Hola <strong>${escapeHtml(params.name)}</strong>,</p>
          ${orgBlock}
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
  organizationLine?: string;
}): string {
  const orgBlock = params.organizationLine
    ? `<p style="margin:0 0 12px 0;padding:12px 14px;border-radius:8px;background-color:#0f1419;border:1px solid #2a3441;font-size:13px;line-height:1.55;color:#94a3b8;"><strong style="color:#e4e4e7;">Organización</strong><br/><span style="color:#e4e4e7;">${escapeHtml(params.organizationLine)}</span></p>`
    : '';
  return buildTpmEmailHtml({
    headline: 'Recupera el acceso a tu cuenta',
    subhead: 'Enlace de un solo uso, válido por 1 hora por seguridad.',
    bodyHtml: `
            <p style="margin:0 0 12px 0;">Hola <strong>${escapeHtml(params.name)}</strong>,</p>
            ${orgBlock}
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

// ── Motor Omnicanal — Compras / Inventario ────────────────────────────────────

/**
 * SRC guardado como borrador — notifica al Jefe de Compras para revisión temprana.
 * Evento: `PURCHASE_REQUISITION_DRAFT_CREATED`.
 */
export function buildMailRequisitionDraftCreated(params: {
  correlative: string;
  requesterName: string;
  description: string;
  itemsCount: number;
  appUrl: string;
  contractName?: string;
}): string {
  const contractLine = params.contractName
    ? `<p style="margin:0 0 8px 0;padding:10px 14px;border-radius:8px;background-color:#0f1419;border:1px solid #2a3441;font-size:13px;color:#94a3b8;"><strong style="color:#e4e4e7;">Contrato</strong> — ${escapeHtml(params.contractName)}</p>`
    : '';
  return buildTpmEmailHtml({
    headline: `Borrador de Requerimiento ${escapeHtml(params.correlative)}`,
    subhead: 'Guardado como DRAFT — pendiente de revisión antes de emitir.',
    bodyHtml: `
      <p style="margin:0 0 12px 0;">Se ha registrado un nuevo borrador de Requerimiento de Compra (SRC) en el sistema.</p>
      ${contractLine}
      <p style="margin:0 0 8px 0;padding:10px 14px;border-radius:8px;background-color:#0f1419;border:1px solid #2a3441;font-size:13px;line-height:1.6;">
        <strong style="color:#e4e4e7;display:block;margin-bottom:4px;">Detalles</strong>
        <span style="color:#94a3b8;">Solicitado por:</span> <span style="color:#e4e4e7;">${escapeHtml(params.requesterName)}</span><br/>
        <span style="color:#94a3b8;">Descripción:</span> <span style="color:#e4e4e7;">${escapeHtml(params.description)}</span><br/>
        <span style="color:#94a3b8;">Ítems:</span> <span style="color:#e4e4e7;">${params.itemsCount}</span>
      </p>
      <p style="margin:0;">Este borrador aún no ha sido emitido formalmente. Puedes revisarlo y coordinar con el solicitante si es necesario.</p>
    `,
    cta: { href: `${params.appUrl}/app/compras/requerimientos`, label: 'Ver Requerimientos' },
  });
}

/**
 * SRC emitido formalmente (SUBMITTED) — notifica al Jefe de Compras para acción inmediata.
 * Evento: `PURCHASE_REQUISITION_SUBMITTED`.
 */
export function buildMailRequisitionSubmitted(params: {
  correlative: string;
  requesterName: string;
  description: string;
  itemsCount: number;
  priority: string;
  appUrl: string;
  contractName?: string;
}): string {
  const priorityColor: Record<string, string> = {
    HIGH: '#f97316',
    MEDIUM: '#eab308',
    LOW: '#94a3b8',
  };
  const pColor = priorityColor[params.priority] ?? '#94a3b8';
  const contractLine = params.contractName
    ? `<p style="margin:0 0 8px 0;padding:10px 14px;border-radius:8px;background-color:#0f1419;border:1px solid #2a3441;font-size:13px;color:#94a3b8;"><strong style="color:#e4e4e7;">Contrato</strong> — ${escapeHtml(params.contractName)}</p>`
    : '';
  return buildTpmEmailHtml({
    headline: `Requerimiento ${escapeHtml(params.correlative)} Emitido`,
    subhead: 'Estado SUBMITTED — requiere gestión de compras.',
    bodyHtml: `
      <p style="margin:0 0 12px 0;">Se ha emitido formalmente un nuevo Requerimiento de Compra (SRC) que requiere tu atención.</p>
      ${contractLine}
      <p style="margin:0 0 8px 0;padding:10px 14px;border-radius:8px;background-color:#0f1419;border:1px solid #2a3441;font-size:13px;line-height:1.7;">
        <strong style="color:#e4e4e7;display:block;margin-bottom:4px;">Resumen</strong>
        <span style="color:#94a3b8;">Solicitado por:</span> <span style="color:#e4e4e7;">${escapeHtml(params.requesterName)}</span><br/>
        <span style="color:#94a3b8;">Descripción:</span> <span style="color:#e4e4e7;">${escapeHtml(params.description)}</span><br/>
        <span style="color:#94a3b8;">Ítems:</span> <span style="color:#e4e4e7;">${params.itemsCount}</span><br/>
        <span style="color:#94a3b8;">Prioridad:</span> <span style="color:${pColor};font-weight:600;">${escapeHtml(params.priority)}</span>
      </p>
      <p style="margin:0;">Revisa y procesa el requerimiento desde el módulo de Compras.</p>
    `,
    cta: { href: `${params.appUrl}/app/compras/requerimientos`, label: 'Gestionar Requerimiento' },
  });
}

/**
 * Nuevo artículo dado de alta en el catálogo maestro.
 * Evento: `INVENTORY_ITEM_CREATED`.
 */
export function buildMailInventoryItemCreated(params: {
  inventoryCode: string;
  name: string;
  categoryName: string;
  createdByName: string;
  appUrl: string;
  partNumber?: string | null;
}): string {
  const pnLine = params.partNumber
    ? `<br/><span style="color:#94a3b8;">Part Number:</span> <span style="color:#e4e4e7;">${escapeHtml(params.partNumber)}</span>`
    : '';
  return buildTpmEmailHtml({
    headline: 'Nuevo artículo en catálogo',
    subhead: `${escapeHtml(params.inventoryCode)} — ${escapeHtml(params.categoryName)}`,
    bodyHtml: `
      <p style="margin:0 0 12px 0;">Se ha dado de alta un nuevo artículo en el catálogo maestro de inventario.</p>
      <p style="margin:0 0 8px 0;padding:10px 14px;border-radius:8px;background-color:#0f1419;border:1px solid #2a3441;font-size:13px;line-height:1.7;">
        <strong style="color:#e4e4e7;display:block;margin-bottom:4px;">Detalles del artículo</strong>
        <span style="color:#94a3b8;">Código:</span> <span style="color:#00e5ff;font-family:monospace;font-weight:600;">${escapeHtml(params.inventoryCode)}</span><br/>
        <span style="color:#94a3b8;">Nombre:</span> <span style="color:#e4e4e7;">${escapeHtml(params.name)}</span><br/>
        <span style="color:#94a3b8;">Familia:</span> <span style="color:#e4e4e7;">${escapeHtml(params.categoryName)}</span>${pnLine}<br/>
        <span style="color:#94a3b8;">Creado por:</span> <span style="color:#e4e4e7;">${escapeHtml(params.createdByName)}</span>
      </p>
      <p style="margin:0;">Puedes consultar el artículo completo, actualizar stock y asignarlo a bodegas desde el catálogo.</p>
    `,
    cta: { href: `${params.appUrl}/app/articulos`, label: 'Ir al Catálogo' },
  });
}

/**
 * Segundo factor por correo (Super Admin, contexto inusual). Mismo layout que el resto:
 * `buildTpmEmailHtml` → kicker + tarjeta con acento + pie `getSystemEmailSignatureHtml()`.
 */
export function buildMailSuperAdminStepUp(params: {
  name: string;
  code: string;
  validMinutes: number;
}): string {
  return buildTpmEmailHtml({
    headline: 'Código de verificación',
    subhead: `Válido ${escapeHtml(String(params.validMinutes))} min · un solo uso · inicio de sesión con paso adicional`,
    bodyHtml: `
            <p style="margin:0 0 12px 0;">Hola <strong>${escapeHtml(params.name)}</strong>,</p>
            <p style="margin:0 0 16px 0;">Se detectó un inicio de sesión como <strong>Super Admin</strong> desde una red o contexto distinto a lo habitual. Usa el código siguiente para continuar. Si tú no iniciaste sesión, no compartas este código y contacta a soporte.</p>
            <p style="margin:0 0 8px 0;padding:16px 18px;border-radius:10px;background-color:#0f1419;border:1px solid #2a3441;border-left:3px solid #00e5ff;font-size:28px;letter-spacing:0.25em;font-weight:700;font-family:ui-monospace,monospace;color:#e4e4e7;text-align:center;">${escapeHtml(params.code)}</p>
            <p style="margin:12px 0 0 0;font-size:13px;color:#94a3b8;">No reenvíes este correo. El código expira en ${params.validMinutes} minutos.</p>
            `,
  });
}
