import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  buildMailInviteUser,
  buildMailResendActivation,
  buildMailForgotPassword,
  buildMailUnusualLogin,
  buildMailSuperAdminStepUp,
  buildMailInventoryItemCreated,
  buildMailEquipmentDown,
} from './transactional-mail.builder';

const SAMPLE_BASE = 'https://tpm.ejemplo.cl';
const SAMPLES: { file: string; title: string; build: () => string }[] = [
  {
    file: '01-invitacion.html',
    title: 'Invitación a usuario (alta de cuenta + activar)',
    build: () =>
      buildMailInviteUser({
        name: 'María Ignacia Pérez',
        role: 'USER',
        activationLink: `${SAMPLE_BASE}/auth/activate?token=ejemplo_token_activacion_hex_64`,
        organizationLine: 'Transportes Ejemplo S.A. — código TPM',
      }),
  },
  {
    file: '02-reenvio-invitacion.html',
    title: 'Reenvío de invitación',
    build: () =>
      buildMailResendActivation({
        name: 'Juan Mecánico',
        role: 'USER',
        activationLink: `${SAMPLE_BASE}/auth/activate?token=otro_token_reeenvio`,
        organizationLine: 'Transportes Ejemplo S.A. — código TPM',
      }),
  },
  {
    file: '03-recuperar-contrasena.html',
    title: 'Olvidé mi contraseña (restablecimiento)',
    build: () =>
      buildMailForgotPassword({
        name: 'Nicolás Sena',
        resetLink: `${SAMPLE_BASE}/auth/reset-password?token=token_reset_1h`,
        organizationLine: 'Transportes Ejemplo S.A. — código TPM',
      }),
  },
  {
    file: '04-alerta-acceso-inusual.html',
    title: 'Alerta: acceso inusual',
    build: () =>
      buildMailUnusualLogin({
        name: 'María Ignacia Pérez',
        deviceLabel: 'Chrome · Windows',
        ip: '190.5.4.2',
        locationLine: 'Santiago, Chile',
      }),
  },
  {
    file: '05-codigo-verificacion-super-admin.html',
    title:
      'Código de verificación (2FA por correo — Super Admin, login inusual)',
    build: () =>
      buildMailSuperAdminStepUp({
        name: 'Operador de plataforma',
        code: '482917',
        validMinutes: 10,
      }),
  },
  {
    file: '06-nuevo-articulo-catalogo.html',
    title: 'Nuevo artículo en catálogo (INVENTORY_ITEM_CREATED)',
    build: () =>
      buildMailInventoryItemCreated({
        itemId: 'a1b2c3d4-e5f6-4789-a012-3456789abcde',
        inventoryCode: 'IN0252',
        name: 'motor BMW N74B681',
        familyName: 'INSUMOS DE MANTENCIÓN',
        subfamilyName: 'Repuesto critico',
        createdBy: 'Nicolás Admin',
        createdAt: '18-05-26, 10:14 a. m.',
        appUrl: SAMPLE_BASE,
        partNumber: 'N74B681',
      }),
  },
  {
    file: '07-equipo-fuera-de-servicio.html',
    title: 'Equipo fuera de servicio (EQUIPMENT_DOWN)',
    build: () =>
      buildMailEquipmentDown({
        faultCorrelative: 'RF-00042',
        equipmentLabel: 'EC-3005 — Caterpillar 980G',
        affectedSystem: 'Motor',
        symptom: 'Pérdida de potencia y humo negro persistente en pendiente.',
        reportedBy: 'Juan Operador',
        eventDate: '03-06-26, 09:40 a. m.',
        workOrderCorrelative: 'OT-2026-018',
        contractName: 'Contrato Minera Norte',
        appUrl: SAMPLE_BASE,
      }),
  },
];

function run() {
  const outDir = path.join(process.cwd(), '../docs', 'email-previews');
  fs.mkdirSync(outDir, { recursive: true });

  const links: string[] = [];
  for (const s of SAMPLES) {
    fs.writeFileSync(path.join(outDir, s.file), s.build(), 'utf8');
    links.push(
      `    <li><a href="${s.file}">${esc(s.title)}</a> <span class="muted">(${s.file})</span></li>`,
    );
  }

  const index = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Previsualización — correos transaccionales TPM / BaseLogic</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, sans-serif; background: #0f1419; color: #e4e4e7; margin: 0; padding: 24px 20px 48px; line-height: 1.5; }
    h1 { font-size: 1.25rem; font-weight: 700; margin: 0 0 8px; }
    p { color: #94a3b8; margin: 0 0 16px; max-width: 64ch; }
    code { background: #0a0f14; padding: 2px 6px; border-radius: 4px; color: #00e5ff; font-size: 0.9em; }
    ul { margin: 0 0 20px; padding-left: 1.2em; }
    a { color: #00e5ff; }
    a:hover { text-decoration: underline; }
    .muted { color: #64748b; font-size: 0.85em; }
    .box { border: 1px solid #2a3441; border-radius: 8px; padding: 10px 14px; background: #0a0f14; margin-top: 12px; font-size: 0.88rem; }
    .note { margin-top: 32px; padding-top: 20px; border-top: 1px solid #2a3441; font-size: 0.8rem; color: #94a3b8; }
    iframe { width: 100%; min-height: 720px; border: 1px solid #2a3441; border-radius: 10px; margin-top: 12px; display: block; }
    h2 { font-size: 0.9rem; font-weight: 600; margin: 24px 0 8px; text-transform: uppercase; letter-spacing: 0.08em; color: #94a3b8; }
  </style>
</head>
<body>
  <h1>Previsualización local de correos</h1>
  <p>Estos HTML salen de las mismas funciones que el backend: <code>transactional-mail.builder.ts</code> y <code>buildTpmEmailHtml</code>. Enlaces y datos son de ejemplo.</p>
  <p>Regenerar (desde carpeta <code>backend</code>): <code>npm run email-previews</code></p>
  <h2>Archivos</h2>
  <ul>
${links.join('\n')}
  </ul>
  <div class="box">Los envíos que <strong>no</strong> usan <code>buildTpmEmailHtml</code> (p. ej. garantía OT, resumen compras) figuran en el catálogo <code>docs/CORREOS-SISTEMA.md</code> en el repositorio; la meta es migrarlos a la plantilla unificada cuando toque.</div>
  <h2>Invitación (incrustado)</h2>
  <iframe title="Vista invitación" src="01-invitacion.html"></iframe>
  <h2>Recuperar contraseña (incrustado)</h2>
  <iframe title="Vista restablecimiento" src="03-recuperar-contrasena.html"></iframe>
  <h2>Código Super Admin (incrustado)</h2>
  <iframe title="Vista código verificación" src="05-codigo-verificacion-super-admin.html"></iframe>
  <p class="note">Abrí también <code>docs/email-previews/01-invitacion.html</code> (y demás) directamente en el navegador con doble clic o “Open with Live Server”.</p>
</body>
</html>
`;
  fs.writeFileSync(path.join(outDir, 'index.html'), index, 'utf8');
  console.log(`Escribí ${SAMPLES.length + 1} archivos en: ${outDir}`);
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

run();
