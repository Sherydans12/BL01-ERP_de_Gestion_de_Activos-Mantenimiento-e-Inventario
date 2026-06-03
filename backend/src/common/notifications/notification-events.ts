/**
 * Catálogo de eventos de notificación del sistema TPM.
 *
 * Cada clave es el `eventKey` estable usado en:
 *   - `TenantNotificationSetting.eventKey`
 *   - `UserNotificationSetting.eventKey`
 *   - `NotificationDispatcherService.dispatch(eventKey, ...)`
 *
 * Al agregar un evento nuevo, registrarlo también en:
 *   - `docs/CORREOS-SISTEMA.md` (si envía email)
 *   - `docs/agentes/notificaciones-sistema.md` (si envía Web Push)
 *
 * **Dispatcher hoy:** `PURCHASE_REQUISITION_DRAFT_CREATED`, `PURCHASE_REQUISITION_SUBMITTED`,
 * `INVENTORY_ITEM_CREATED` (ver `NotificationDispatcherService.dispatch` en el repo).
 */
export const NOTIFICATION_EVENTS = {
  // ── Usuarios / Auth ───────────────────────────────────────────────────────
  USER_INVITE: 'USER_INVITE',
  USER_RESEND_ACTIVATION: 'USER_RESEND_ACTIVATION',
  AUTH_FORGOT_PASSWORD: 'AUTH_FORGOT_PASSWORD',
  AUTH_UNUSUAL_LOGIN: 'AUTH_UNUSUAL_LOGIN',

  // ── Compras ───────────────────────────────────────────────────────────────
  /** Nuevo requerimiento de compra (SRC) creado, pendiente de gestión. */
  PURCHASE_REQUISITION_CREATED: 'PURCHASE_REQUISITION_CREATED',
  /** SRC guardado como borrador (DRAFT); notifica al Jefe de Compras para revisión temprana. */
  PURCHASE_REQUISITION_DRAFT_CREATED: 'PURCHASE_REQUISITION_DRAFT_CREATED',
  /** SRC emitido formalmente (SUBMITTED); notifica al Jefe de Compras para acción. */
  PURCHASE_REQUISITION_SUBMITTED: 'PURCHASE_REQUISITION_SUBMITTED',
  /** Orden de Compra pendiente de firma por uno o más aprobadores. */
  PURCHASE_PO_PENDING_SIGNATURE: 'PURCHASE_PO_PENDING_SIGNATURE',
  /** Lote de OC generadas pendientes de firma (resumen diario/batch). */
  PURCHASE_PO_BATCH_SIGNATURE: 'PURCHASE_PO_BATCH_SIGNATURE',
  /** Discrepancia de 3-way match en factura de proveedor. */
  INVOICE_DISCREPANCY: 'INVOICE_DISCREPANCY',

  // ── Órdenes de Trabajo ────────────────────────────────────────────────────
  /** OT cerrada con marca de posible garantía; notifica lista de correos externa. */
  OT_WARRANTY_NOTIFY: 'OT_WARRANTY_NOTIFY',

  // ── Operaciones / Flota ───────────────────────────────────────────────────
  /** Falla de criticidad ALTA dejó un equipo fuera de servicio (isOperational=false). */
  EQUIPMENT_DOWN: 'EQUIPMENT_DOWN',

  // ── Inventario ────────────────────────────────────────────────────────────
  /** Stock de un artículo alcanzó o cayó bajo el mínimo definido. */
  INVENTORY_STOCK_MIN: 'INVENTORY_STOCK_MIN',
  /** Nuevo artículo dado de alta en el catálogo maestro del tenant. */
  INVENTORY_ITEM_CREATED: 'INVENTORY_ITEM_CREATED',
} as const;

export type NotificationEventKey =
  (typeof NOTIFICATION_EVENTS)[keyof typeof NOTIFICATION_EVENTS];
