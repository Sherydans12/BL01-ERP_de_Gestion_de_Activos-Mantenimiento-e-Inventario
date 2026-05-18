# Catálogo de envíos de correo — TPM / BaseLogic

Documento **maestro** de todo lo que el backend puede enviar vía `EmailService.sendMail` o `NotificationDispatcherService`. Sirve para operación, auditoría y configuración de plantillas.

| ID | Asunto (referencia) | Disparador | Destinatario(s) | Código (entrada) | Plantilla / HTML | Preview local | Motor |
|----|---------------------|------------|-----------------|-------------------|------------------|---------------|-------|
| `USER_INVITE` | `Invitación a Sistema TPM` | Alta de usuario (invitación) | Email del invitado | `users.service` → `create` | `buildMailInviteUser` | `docs/email-previews/01-invitacion.html` | Directo |
| `USER_RESEND_ACTIVATION` | `Reenvío de Invitación - Sistema TPM` | Reenvío de activación | Email del usuario | `users.service` → `resendActivation` | `buildMailResendActivation` | `docs/email-previews/02-reenvio-invitacion.html` | Directo |
| `AUTH_FORGOT_PASSWORD` | `Recuperación de contraseña — Sistema TPM` | Flujo "Olvidé mi contraseña" | Email solicitante | `auth.service` | `buildMailForgotPassword` | `docs/email-previews/03-recuperar-contrasena.html` | Directo |
| `AUTH_UNUSUAL_LOGIN` | `Alerta de seguridad — acceso inusual en TPM` | Login exitoso con IP/país distinto al historial | Usuario | `auth.service` | `buildMailUnusualLogin` | `docs/email-previews/04-alerta-acceso-inusual.html` | Directo |
| `AUTH_SUPER_ADMIN_STEP_UP` | `Código de verificación — inicio de sesión TPM (Super Admin)` | 2FA por correo: login Super Admin con contexto inusual | Usuario Super Admin | `login-step-up.service` | `buildMailSuperAdminStepUp` | `docs/email-previews/05-codigo-verificacion-super-admin.html` | Directo |
| `OT_WARRANTY_NOTIFY` | `[TPM] Solicitud de garantía · {OT}` | Cierre de OT marcada posible garantía | Lista de correos (env) | `work-orders.service` | HTML mínimo en línea | — (pendiente `buildTpmEmailHtml`) | Directo |
| `PURCHASE_PO_BATCH_SIGNATURE` | Dinámico (N órdenes pendientes de firma) | Lote de OC generadas, pendientes de firma | Aprobadores | `purchase-orders.service` | HTML mínimo (`<p>…</p>`) | — (pendiente) | Directo |
| `PURCHASE_REQUISITION_CREATED` | `Nuevo Requerimiento de Compra` | SRC creado, pendiente de gestión | Jefe de Compras | pendiente migración | pendiente | — | pendiente migración |
| `INVOICE_DISCREPANCY` | `Discrepancia en factura` | 3-way match falla en recepción | Autorizadores / compras | pendiente | pendiente | — | pendiente |
| `INVENTORY_STOCK_MIN` | `Alerta: stock mínimo alcanzado` | Stock de artículo ≤ mínimo definido | Bodeguero / admin | pendiente | pendiente | — | pendiente |
| `PURCHASE_REQUISITION_DRAFT_CREATED` | `Nuevo borrador de requerimiento: {correlativo}` | SRC guardado en estado DRAFT | ADMINs activos con opt-in + ccEmails del tenant | `purchase-requisitions.service` → `create` | `buildMailRequisitionDraftCreated` | — | **Dispatcher** |
| `PURCHASE_REQUISITION_SUBMITTED` | `Requerimiento emitido: {correlativo}` | SRC pasa a SUBMITTED | ADMINs activos con opt-in + ccEmails del tenant | `purchase-requisitions.service` → `submit` | `buildMailRequisitionSubmitted` | — | **Dispatcher** |
| `INVENTORY_ITEM_CREATED` | `Nuevo artículo en catálogo: {código} — {nombre}` | Alta en catálogo maestro: `POST /api/inventory-items` **o** `POST /api/inventory-items/quick-create` (modal rápido solo donde `GlobalItemPicker` expone quick-add: SRC, OC, OT, y en stock movimientos `PURCHASE_IN` / `TRANSFER`; **no** en transferencia W2W dedicada ni en picker de salida a terreno / reingreso / devolución OT) | ccEmails del tenant (solo correo externo; userIds vacío) | `inventory-items.service` → `create`, `quickCreate` | `buildMailInventoryItemCreated` | — | **Dispatcher** |

> **Columna "Motor":** `Directo` = llama a `EmailService.sendMail` directamente. `Dispatcher` = pasa por `NotificationDispatcherService` con opt-in estricto y ccEmails. La migración de los flujos "Directo" es opcional y gradual.

---

## Motor Omnicanal — `NotificationDispatcherService` (desde 2026-05-18)

Los envíos marcados como **"Dispatcher"** no llaman a `EmailService` directamente. Pasan por `NotificationDispatcherService.dispatch(eventKey, tenantId, payload)`.

### Modelo Opt-in estricto

> **Por defecto, ningún usuario recibe notificaciones** a menos que tenga un registro explícito `UserNotificationSetting { eventKey, channel, enabled: true }`.

Pasos internos del dispatcher:

1. Consulta `TenantNotificationSetting` para el evento: si `enabled = false` o no existe, aborta silenciosamente.
2. Recupera los `ccEmails` del tenant (listas externas → no requieren opt-in de usuario).
3. Filtra los `userIds` del payload cruzando contra `UserNotificationSetting` (`enabled = true`) y verifica `isActive` del usuario.
4. Despacha en paralelo: `EmailService.sendMail` (con `cc: ccEmails`) para canal EMAIL, `NotificationsService.sendNotification` para WEB_PUSH.

### `ccEmails` — correos externos (listas de distribución)

El campo `TenantNotificationSetting.ccEmails` (`String[]`) permite agregar correos externos (p. ej. `bodega.ext@cliente.com`) como CC en los envíos del evento. Se configuran desde la UI de gobernanza (`/app/configuracion/notificaciones`) **sin requerir opt-in** de usuario, ya que son correos fuera del sistema (grupos de distribución del cliente final). Este mecanismo resuelve el caso de bodegas o departamentos que reciben avisos por correo grupal sin ser usuarios de la plataforma.

### Resolución de `userIds` por servicio

| Evento | Pool de candidatos que provee el servicio | Filtro aplicado por el dispatcher |
|--------|-------------------------------------------|-----------------------------------|
| `PURCHASE_REQUISITION_DRAFT_CREATED` | ADMINs activos del tenant (`role='ADMIN', isActive=true`) | `UserNotificationSetting` opt-in (canal EMAIL / WEB_PUSH) |
| `PURCHASE_REQUISITION_SUBMITTED` | ADMINs activos del tenant | `UserNotificationSetting` opt-in + WEB_PUSH si hay `pushPayload` |
| `INVENTORY_ITEM_CREATED` | `[]` vacío (no hay candidatos internos) | Solo los ccEmails del tenant reciben el correo |

### API de gobernanza (ADMIN / SUPER_ADMIN)

```
GET  /api/notification-settings/tenant          → config global del tenant por evento
PUT  /api/notification-settings/tenant          → activar/desactivar evento, gestionar ccEmails
GET  /api/notification-settings/user?userId=    → config de usuario (self o admin delegado)
PUT  /api/notification-settings/user            → suscribir/desuscribir canal (self o RBAC)
GET  /api/notification-settings/event?eventKey= → matriz de suscriptores del evento
```

Para la arquitectura completa de canales, Web Push e historial de cambios: [`docs/agentes/notificaciones-sistema.md`](agentes/notificaciones-sistema.md).

---

## Cómo mantener este documento (obligatorio para implementaciones nuevas)

1. **Cada nuevo envío (Directo o Dispatcher):** añade una fila con un `ID` estable o actualiza la fila existente.
2. Si el correo usa `buildTpmEmailHtml` / `transactional-mail.builder.ts`: añade también una entrada en `backend/src/common/email/preview-renderer.ts` y ejecuta `npm run email-previews` desde `backend/`.
3. Objetivo de producto: con este inventario se puede mapear "tipo de envío → plantilla, CC, cola, opt-in" sin releer todo el código.

---

## Referencias técnicas

- Guía de formato y flujo: [`docs/agentes/correos-transaccionales.md`](agentes/correos-transaccionales.md)
- Web Push (canal paralelo): [`docs/agentes/notificaciones-sistema.md`](agentes/notificaciones-sistema.md)
- Código: `backend/src/common/email/email-templates.ts`, `transactional-mail.builder.ts`, `preview-renderer.ts`
- Dispatcher: `backend/src/common/notifications/notification-dispatcher.service.ts`
- Seguridad / 2FA Super Admin: [`docs/agentes/seguridad-auth.md`](agentes/seguridad-auth.md)
