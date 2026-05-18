# Catálogo de envíos de correo — TPM / BaseLogic

Documento **maestro** de todo lo que el backend puede enviar vía `EmailService.sendMail`. Sirve para operación, auditoría y para un **futuro módulo de configuración** (plantillas, activación por tipo, recordatorios).

| ID | Asunto (referencia) | Disparador | Destinatario(s) | Código (entrada) | Plantilla / HTML | Preview local |
|----|---------------------|------------|-----------------|-------------------|------------------|---------------|
| `USER_INVITE` | `Invitación a Sistema TPM` | Alta de usuario (invitación) | Email del invitado | `users.service` → `create` | `buildMailInviteUser` | `docs/email-previews/01-invitacion.html` |
| `USER_RESEND_ACTIVATION` | `Reenvío de Invitación - Sistema TPM` | Reenvío de activación | Email del usuario | `users.service` → `resendActivation` | `buildMailResendActivation` | `docs/email-previews/02-reenvio-invitacion.html` |
| `AUTH_FORGOT_PASSWORD` | `Recuperación de contraseña — Sistema TPM` | Flujo “Olvidé mi contraseña” | Email solicitante | `auth.service` | `buildMailForgotPassword` | `docs/email-previews/03-recuperar-contrasena.html` |
| `AUTH_UNUSUAL_LOGIN` | `Alerta de seguridad — acceso inusual en TPM` | Login exitoso con IP/país distinto al historial (si el usuario tiene `notifyUnusualLogin`) | Usuario | `auth.service` | `buildMailUnusualLogin` | `docs/email-previews/04-alerta-acceso-inusual.html` |
| `AUTH_SUPER_ADMIN_STEP_UP` | `Código de verificación — inicio de sesión TPM (Super Admin)` | 2FA por correo: login Super Admin con contexto inusual (política global) | Usuario Super Admin | `login-step-up.service` | `buildMailSuperAdminStepUp` | `docs/email-previews/05-codigo-verificacion-super-admin.html` |
| `OT_WARRANTY_NOTIFY` | `[TPM] Solicitud de garantía · {OT}` | Cierre de OT marcada posible garantía (si `WARRANTY_NOTIFY_EMAILS` está definida) | Lista de correos (env) | `work-orders.service` | HTML mínimo en línea | — (pendiente alinear a `buildTpmEmailHtml`) |
| `PURCHASE_PO_BATCH_SIGNATURE` | Dinámico (p. ej. N órdenes pendientes de firma) | Lote de OC generadas, pendientes de firma | Aprobadores (emails de usuarios internos) | `purchase-orders.service` | HTML mínimo (`<p>…</p>`) | — (pendiente alinear a `buildTpmEmailHtml`) |

**Nota:** en compras, el mismo evento puede generar además **Web Push** (`NotificationsService.sendNotification`); no sustituyen al correo. Inventario y payloads: [`docs/agentes/notificaciones-sistema.md`](agentes/notificaciones-sistema.md).

## Cómo mantener este documento (obligatorio para implementaciones nuevas)

1. **Cada nuevo** `EmailService.sendMail` o nuevo tipo de plantilla: añade **una fila** (nuevo `ID` estable) o actualiza la fila existente.
2. Si el correo usa `buildTpmEmailHtml` / `transactional-mail.builder.ts`: añade también una entrada en `backend/src/common/email/preview-renderer.ts` y regenerá `docs/email-previews/` (`npm run email-previews` desde `backend/`).
3. Objetivo de producto: con este inventario se puede, más adelante, mapear “tipo de envío → plantilla, CC, cola, opt-out” sin releer todo el código.

## Referencias técnicas

- Guía de formato y flujo: [`docs/agentes/correos-transaccionales.md`](agentes/correos-transaccionales.md)
- Web Push (canal paralelo, no es `sendMail`): [`docs/agentes/notificaciones-sistema.md`](agentes/notificaciones-sistema.md)
- Código: `backend/src/common/email/email-templates.ts`, `transactional-mail.builder.ts`, `preview-renderer.ts`
- Seguridad / 2FA Super Admin: [`docs/agentes/seguridad-auth.md`](agentes/seguridad-auth.md)
