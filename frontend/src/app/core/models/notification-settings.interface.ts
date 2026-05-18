/** Canales de notificación disponibles. Espejo del enum Prisma `NotificationChannel`. */
export type NotificationChannel = 'EMAIL' | 'WEB_PUSH';

/**
 * Claves estables de eventos de notificación.
 * Deben coincidir con `NOTIFICATION_EVENTS` en `notification-events.ts` del backend.
 */
export type NotificationEventKey =
  | 'USER_INVITE'
  | 'USER_RESEND_ACTIVATION'
  | 'AUTH_FORGOT_PASSWORD'
  | 'AUTH_UNUSUAL_LOGIN'
  | 'PURCHASE_REQUISITION_CREATED'
  | 'PURCHASE_PO_PENDING_SIGNATURE'
  | 'PURCHASE_PO_BATCH_SIGNATURE'
  | 'INVOICE_DISCREPANCY'
  | 'OT_WARRANTY_NOTIFY'
  | 'INVENTORY_STOCK_MIN'
  | (string & {}); // Permite eventos futuros sin romper el tipado

/** Configuración de un evento a nivel de tenant (interruptor maestro). */
export interface TenantNotificationSetting {
  id: string;
  tenantId: string;
  eventKey: NotificationEventKey;
  enabled: boolean;
  /** Correos adicionales fijos que siempre reciben CC cuando el evento se despacha por EMAIL. */
  ccEmails: string[];
  createdAt: string;
  updatedAt: string;
}

/** Suscripción individual de un usuario a un canal+evento. */
export interface UserNotificationSetting {
  id: string;
  tenantId: string;
  userId: string;
  eventKey: NotificationEventKey;
  channel: NotificationChannel;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Suscripción enriquecida con datos del usuario (respuesta de `GET /notification-settings/event`). */
export interface UserNotificationSettingWithUser extends UserNotificationSetting {
  user: {
    id: string;
    name: string;
    email: string;
    role: string;
    isActive: boolean;
    avatarUrl?: string | null;
    customRole?: { id: string; name: string } | null;
  };
}

/** Agrupación de suscripciones por usuario para la vista de matriz. */
export interface UserSubscriptionRow {
  userId: string;
  name: string;
  email: string;
  role: string;
  avatarUrl?: string | null;
  customRole?: { id: string; name: string } | null;
  emailEnabled: boolean;
  pushEnabled: boolean;
}

/** DTO para actualizar el interruptor maestro de un evento en el tenant. */
export interface UpsertTenantNotificationSettingPayload {
  eventKey: NotificationEventKey;
  enabled: boolean;
  /** Correos CC fijos (opcional; si no se envía, el backend conserva los actuales). */
  ccEmails?: string[];
}

/**
 * DTO para actualizar la suscripción de un usuario a un canal+evento.
 *
 * - `targetUserId` ausente → auto-gestión (cualquier usuario autenticado).
 * - `targetUserId` presente y distinto al caller → requiere rol ADMIN/SUPER_ADMIN
 *   (el backend lanza 403 si no se cumple).
 */
export interface UpsertUserNotificationSettingPayload {
  /** ID del usuario destino. Omitir para auto-gestión; proveer para gestión delegada por ADMIN. */
  targetUserId?: string;
  eventKey: NotificationEventKey;
  channel: NotificationChannel;
  enabled: boolean;
}
