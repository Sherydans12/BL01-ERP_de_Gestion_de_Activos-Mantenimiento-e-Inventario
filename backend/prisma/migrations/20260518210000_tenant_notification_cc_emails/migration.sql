-- Agrega campo cc_emails al interruptor maestro de notificaciones por tenant.
-- Almacena un arreglo de correos fijos que siempre reciben copia (CC) cuando
-- el evento se despacha por canal EMAIL, independientemente de las suscripciones
-- individuales de los usuarios.

ALTER TABLE "tenant_notification_settings"
    ADD COLUMN "cc_emails" TEXT[] NOT NULL DEFAULT '{}';
