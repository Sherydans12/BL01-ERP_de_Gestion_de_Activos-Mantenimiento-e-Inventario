# Notificaciones del sistema (BL01 / TPM)

Documento **maestro de canales salientes** que hoy implementa el repo: **Web Push** (navegador) y referencia a **correo** cuando comparte el mismo disparador. Las **toasts in-app** (`NotificationService` en Angular) son UI local; **no** se listan aquí salvo mención de alcance.

**Mantenimiento obligatorio para agentes y equipo:** al añadir un nuevo envío `NotificationsService.sendNotification` (o un canal equivalente), **actualizá este archivo** en el mismo PR: tabla de inventario, disparadores y payload. Enlazá con [PURCHASE-GOVERNANCE.md](../PURCHASE-GOVERNANCE.md) / [PURCHASE-FLOWS.md](../PURCHASE-FLOWS.md) si el flujo es compras.

**Reglas Cursor relacionadas:**

- Contexto e índice: [`.cursor/rules/erp-bl01-context.mdc`](../../.cursor/rules/erp-bl01-context.mdc) → convención de doc en `docs/agentes/`.
- Índice humano: [`AGENTS.md`](../../AGENTS.md), [`docs/agentes/README.md`](README.md).
- **Correo** (otro canal): catálogo en [`docs/CORREOS-SISTEMA.md`](../CORREOS-SISTEMA.md) y flujo técnico en [`correos-transaccionales.md`](correos-transaccionales.md) — alinear si el mismo evento dispara mail.
- **Secretos / VAPID:** claves solo en entorno; revisar [`.cursor/skills/ecc-security-review/SKILL.md`](../../.cursor/skills/ecc-security-review/SKILL.md) si exponés endpoints o datos en payloads.

---

## 1. Arquitectura Web Push

| Capa | Ubicación | Notas |
|------|-----------|--------|
| Backend | `backend/src/features/notifications/notifications.service.ts` | `web-push` + VAPID; `sendNotification(userId, title, body, data?)`. |
| Registro de suscripción | `POST /api/notifications/subscribe` → `notifications.controller.ts` | Cuerpo estándar Push API; persiste `PushSubscription` (único por `endpoint`). Requiere usuario con `tenantId`. |
| Modelo Prisma | `PushSubscription` | Por usuario; purga en herramienta SUPER_ADMIN: [`platform-data-admin.md`](platform-data-admin.md). |
| Frontend | `frontend/src/app/core/services/push-notifications/push-notifications.service.ts` | `SwPush` + Angular Service Worker; clic → navegación según `data`. |
| Auto-registro | `frontend/src/app/core/layout/layout.component.ts` | Usuarios con `purchases:order:approve` (PBAC); una vez por sesión (`maybeSubscribeOncePerSession`). |

**Variables de entorno (backend):** `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, opcional `VAPID_SUBJECT` (default `mailto:admin@baselogic.local`). Si faltan las claves, **no se envía ningún push** (silencioso en runtime salvo log).

**Frontend:** `environment.vapidPublicKey` debe coincidir con la clave pública del servidor.

**Formato del payload:** JSON con nodo `notification: { title, body, data }` — compatible con el manejo de push de `@angular/service-worker` (ver comentario en `notifications.service.ts`).

---

## 2. Inventario: notificaciones Web Push activas

Todas las llamadas actuales a `sendNotification` están en **`purchase-orders.service.ts`** y **`purchase-invoices.service.ts`**.

| `data.type` | Cuándo se dispara | Destinatarios | Título / cuerpo (resumen) | `data` útil (strings) | Código |
|-------------|-------------------|---------------|-------------------------|------------------------|--------|
| `PURCHASE_ORDER_PENDING_SIGNATURE` | (1) Creación de OC desde cotización ganadora.<br>(2) Tras una firma, si la OC queda `PARTIALLY_APPROVED` (siguiente nivel).<br>(3) Edición de OC que la deja otra vez `PENDING_APPROVAL`. | Usuarios en `allowedUsers` de la **política del siguiente nivel** no firmado, activos, con acceso al contrato de la OC (vía `contractAccess` o rol admin según query). | `OC {correlative} pendiente de firma` + descripción de política o «Nivel N» + monto. | `orderId`, `correlative`, `level` (siguiente nivel) | `purchase-orders.service.ts` → `notifyApproversForPendingSignature` |
| `PURCHASE_ORDER_BATCH_PENDING_SIGNATURE` | Tras **split** de un requerimiento en **varias OC** nuevas (mismo batch). | Misma lógica de «siguiente firmante» agregada por OC del batch (receptores unificados en un set). | Resumen: N órdenes pendientes, correlativos SRC, proveedores, montos. | `requisitionCorrelative`, `orderIds` (comma-separated), `firstOrderId` | `purchase-orders.service.ts` → `notifyApproversForPendingSignatureBatch` |
| `INVOICE_DISCREPANCY` | Al registrar/actualizar factura de compra y el estado pasa a **`DISCREPANCY`**. | `ADMIN`, `SUPER_ADMIN`, y usuarios con rol custom cuyo nombre o descripción contiene «Finanzas» o «Contabilidad» (insensitive) **y** `contractAccess` al contrato de la OC. | `⚠️ Discrepancia en Factura: {invoiceNumber}` + texto OC/recepción. | `orderId`, `invoiceId` | `purchase-invoices.service.ts` → `notifyInvoiceDiscrepancy` |

**Clic en la notificación (cliente):** `PushNotificationsService` usa `orderId` de `data` para navegar a `/app/compras/ordenes/:orderId`. Si `type === 'INVOICE_DISCREPANCY'`, añade `queryParams: { tab: 'billing' }`. Para el batch, conviene que el payload incluya al menos un `orderId` usable (hoy también llega `firstOrderId`); si en el futuro se cambia la navegación, actualizar **este doc** y `parsePushNotificationData`.

---

## 3. Correo en el mismo flujo (no es push)

| Evento | Canal | Notas |
|--------|--------|--------|
| Resumen tras split de OC (batch pendiente de firma) | **Correo** opcional (además del push) | Mismo asunto/cuerpo que el push; si SMTP falla, solo log. No está catalogado como plantilla transaccional compleja; si se formaliza, añadir fila en [`CORREOS-SISTEMA.md`](../CORREOS-SISTEMA.md). |

El resto de correos del sistema siguen el workflow de **Correos** en [`tpm-arquitectura.mdc`](../../.cursor/rules/tpm-arquitectura.mdc) sección 6.

---

## 4. Reglas de negocio enlazadas

- Matriz de firmas, niveles y `minAmount`: [`docs/PURCHASE-GOVERNANCE.md`](../PURCHASE-GOVERNANCE.md).
- Flujo SRC → OC → recepción: [`docs/PURCHASE-FLOWS.md`](../PURCHASE-FLOWS.md).
- Despliegue y variables (incl. entorno producción): [`DEPLOY-COOLIFY.md`](../../DEPLOY-COOLIFY.md).

---

## 5. Cómo añadir una nueva notificación push (checklist)

1. **Implementación:** usar `NotificationsService.sendNotification` (o extender el servicio si hace falta batch/borrado selectivo). Respetar **multi-tenant**: suscripciones ya van por `userId` + `tenantId` en BD; los **destinatarios** deben seguir las mismas reglas de acceso que el resto del módulo (contrato, rol, etc.).
2. **Payload:** mantener `data.type` estable (string único). Incluir solo datos necesarios para deep-link; preferir IDs ya expuestos al cliente.
3. **Frontend:** si hace falta navegación al clic, actualizar `parsePushNotificationData` en `push-notifications.service.ts`.
4. **Documentación:** añadir fila a la **tabla del §2** en este archivo.
5. **Correo u otro canal:** si el mismo evento envía mail, registrar en [`CORREOS-SISTEMA.md`](../CORREOS-SISTEMA.md) y seguir [`correos-transaccionales.md`](correos-transaccionales.md) cuando aplique.
6. **Seguridad / API:** nuevo endpoint de registro o cambios en DTO → alinear con **ecc-api-design** y **ecc-security-review** (skills en `.cursor/skills/`).
7. **AGENTS / índice:** si el dominio es nuevo, valorar enlace desde [`AGENTS.md`](../../AGENTS.md) o desde [`README.md`](README.md) del módulo correspondiente.

---

## 6. Motor Omnicanal — `NotificationDispatcherService`

Desde 2026-05-18 existe una capa de despacho unificada para envíos nuevos. Los flujos legados (OC, factura, etc.) siguen llamando directamente a `sendNotification` / `sendMail` hasta que sean migrados.

| Capa | Archivo |
|------|---------|
| Despachador | `backend/src/common/notifications/notification-dispatcher.service.ts` |
| Catálogo de eventos | `backend/src/common/notifications/notification-events.ts` (`NOTIFICATION_EVENTS`) |
| Config de tenant | `TenantNotificationSetting` — interruptor maestro + `ccEmails` (listas externas) |
| Config de usuario | `UserNotificationSetting` — canal EMAIL / WEB_PUSH por evento (**opt-in estricto**) |
| API REST (ADMIN) | `GET/PUT /api/notification-settings/tenant`, `GET/PUT /api/notification-settings/user`, `GET /api/notification-settings/event` |
| UI de gobernanza | `frontend/src/app/features/settings/notification-governance/` (`/app/configuracion/notificaciones`) |
| Interfaces Angular | `frontend/src/app/core/models/notification-settings.interface.ts` |
| Servicio Angular | `frontend/src/app/core/services/notification-settings/notification-settings.service.ts` |

### Modelo Opt-in estricto

> **Por defecto ningún usuario recibe notificaciones.** Se requiere un registro explícito `UserNotificationSetting { eventKey, channel, enabled: true }` para recibir por EMAIL o WEB_PUSH.

Flujo del dispatcher al recibir un `dispatch(eventKey, tenantId, payload)`:

1. Busca `TenantNotificationSetting` para el evento. Si existe y `enabled = false`, aborta silenciosamente. Si no hay fila, continúa (sin `ccEmails` persistidos hasta que el admin guarde en gobernanza).
2. Extrae `ccEmails` del registro de tenant (si existe).
3. Si **no** hay `userIds` ni `ccEmails`, aborta.
4. Si **no** hay `userIds` pero sí `ccEmails`, modo **solo CC**: exige registro de tenant con `enabled = true` y envía un correo con `to = ccEmails`.
5. Con `userIds` no vacío: consulta `UserNotificationSetting` con `enabled: true` y verifica `User.isActive`. Si **nadie** califica pero hay `ccEmails` e interruptor activo, envío **solo a CC** (listas externas siguen enteradas).
6. Con suscriptores: agrupa canales; `EmailService.sendMail` (`to` = usuarios opt-in EMAIL, `cc` = `ccEmails` si hay). Si no queda ningún envío a usuario (p. ej. solo WEB_PUSH en un evento sin `pushPayload`) pero hay CC configurados, **correo solo a CC**.
7. `NotificationsService.sendNotification` para WEB_PUSH cuando aplique.

### `ccEmails` — listas de distribución externas

`TenantNotificationSetting.ccEmails` es un array de strings con correos externos (p. ej. grupos de bodega, listas de jefes de planta). Se administran desde la UI de gobernanza y se inyectan automáticamente como `cc` en cada envío del evento. **No requieren que existan como usuarios en la plataforma.**

### Catálogo de eventos activos con dispatch inyectado

| `NOTIFICATION_EVENTS.*` | Disparador en código | Pool de `userIds` | Canal(es) |
|-------------------------|---------------------|-------------------|-----------|
| `PURCHASE_REQUISITION_DRAFT_CREATED` | `purchase-requisitions.service` → `create` | ADMINs activos del tenant | EMAIL + ccEmails |
| `PURCHASE_REQUISITION_SUBMITTED` | `purchase-requisitions.service` → `submit` | ADMINs activos del tenant | EMAIL + WEB_PUSH + ccEmails |
| `INVENTORY_ITEM_CREATED` | `inventory-items.service` → `create`, `quickCreate` | Opt-in **EMAIL** (IDs resueltos en el servicio) + `ccEmails` | EMAIL (+ CC tenant) o solo CC si no hay suscriptores EMAIL |
| `EQUIPMENT_DOWN` | `fault-reports.service` → `create` (solo `FaultCriticality.HIGH`) | ADMINs activos del tenant + usuarios con `UserContract` al contrato del equipo | EMAIL + WEB_PUSH (opt-in) + ccEmails |

La gobernanza en `/app/configuracion/notificaciones` muestra **más** `eventKey` (catálogo de producto / futuro). Solo los de la tabla anterior tienen **`NotificationDispatcherService.dispatch`** en el código actual; el resto puede persistir preferencias en BD pero aún **no** dispara este motor hasta que el flujo de negocio correspondiente llame a `dispatch` (o siga siendo envío **Directo** vía `EmailService`).

### Uso en nuevas funcionalidades

```typescript
// Fire-and-forget (no bloquea la respuesta)
this.notificationDispatcher
  .dispatch(NOTIFICATION_EVENTS.PURCHASE_REQUISITION_SUBMITTED, tenantId, {
    userIds: adminIds,           // pool de candidatos; el dispatcher filtra opt-in
    subject: 'SRC emitido: ...',
    html: buildMailRequisitionSubmitted({ ... }),
    pushPayload: {               // opcional: activa WEB_PUSH además de EMAIL
      title: 'SRC emitido',
      body: 'Ver en compras',
      data: { type: 'PURCHASE_REQUISITION_SUBMITTED', requisitionId: id },
    },
  })
  .catch(() => { /* fallo silencioso */ });
```

---

## 7. Historial de cambios (opcional)

| Fecha | Cambio |
|-------|--------|
| 2026-05-17 | Creación del documento; inventario alineado con `sendNotification` en compras (OC + factura discrepancia). |
| 2026-05-18 | Motor Omnicanal: `NotificationDispatcherService`, catálogo `NOTIFICATION_EVENTS`, modelos `TenantNotificationSetting` / `UserNotificationSetting`, API REST de configuración, UI de gobernanza. |
| 2026-05-18 | Opt-in estricto + RBAC delegado: el dispatcher consulta directamente `UserNotificationSetting`; admins pueden configurar notificaciones de otros usuarios. `ccEmails` en `TenantNotificationSetting`. |
| 2026-05-18 | Sprint closure: 3 eventos nuevos (`PURCHASE_REQUISITION_DRAFT_CREATED`, `PURCHASE_REQUISITION_SUBMITTED`, `INVENTORY_ITEM_CREATED`), builders en `transactional-mail.builder.ts`, dispatch inyectado en `purchase-requisitions.service` y `inventory-items.service`. Sidebar acordeón en UI. |
| 2026-05-18 | `INVENTORY_ITEM_CREATED`: mismo dispatch en `quickCreate` (paridad con `create`); UX vía `QuickAddItemModal` en `GlobalItemPicker` **solo** donde `allowQuickAdd` es true (SRC, OC, OT, stock `PURCHASE_IN`/`TRANSFER`; no W2W dedicada ni picker salida/reingreso/devolución OT). |
| 2026-05-18 | **Fix dispatcher:** con `userIds` vacío y `ccEmails` del tenant, envío «solo CC» (antes abortaba siempre y `INVENTORY_ITEM_CREATED` nunca enviaba). |
| 2026-05-18 | **Dispatcher:** si hay pool `userIds` pero nadie con opt-in efectivo (o solo WEB_PUSH sin tareas), **fallback** a correo solo a `ccEmails` cuando el evento está activo (SRC + listas externas). |
| 2026-05-18 | Correo `INVENTORY_ITEM_CREATED`: el botón «Ver artículo» usa la URL de ficha con **UUID** del registro (`/app/articulos/:id`), no el código `IN####` (evita error Prisma / redirección). |
|| 2026-06-03 | `EQUIPMENT_DOWN`: nuevo evento de flota/operaciones; dispara `fault-reports.service` al cerrar transaccion de falla ALTA (fire-and-forget). Pool = ADMINs + `UserContract` al contrato del equipo. Deep-link push a /app/operaciones/fallas. Plantilla `buildMailEquipmentDown`. 15 tests en suite domain. |
