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
| Auto-registro | `frontend/src/app/core/layout/layout.component.ts` | Solo roles `ADMIN`, `SUPER_ADMIN`, `SUPERVISOR`; una vez por sesión (`maybeSubscribeOncePerSession`). |

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

## 6. Historial de cambios (opcional)

| Fecha | Cambio |
|-------|--------|
| 2026-05-17 | Creación del documento; inventario alineado con `sendNotification` en compras (OC + factura discrepancia). |
