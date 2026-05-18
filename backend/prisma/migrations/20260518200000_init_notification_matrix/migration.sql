-- Motor Omnicanal de Notificaciones: enum + tablas de configuración

-- Enum: canal de notificación
CREATE TYPE "NotificationChannel" AS ENUM ('EMAIL', 'WEB_PUSH');

-- Interruptor maestro por evento y tenant
CREATE TABLE "tenant_notification_settings" (
    "id"         UUID         NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id"  UUID         NOT NULL,
    "event_key"  VARCHAR(100) NOT NULL,
    "enabled"    BOOLEAN      NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_notification_settings_pkey" PRIMARY KEY ("id")
);

-- Suscripción individual usuario / evento / canal
CREATE TABLE "user_notification_settings" (
    "id"         UUID                  NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id"  UUID                  NOT NULL,
    "user_id"    UUID                  NOT NULL,
    "event_key"  VARCHAR(100)          NOT NULL,
    "channel"    "NotificationChannel" NOT NULL,
    "enabled"    BOOLEAN               NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3)          NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3)          NOT NULL,

    CONSTRAINT "user_notification_settings_pkey" PRIMARY KEY ("id")
);

-- Restricciones de unicidad
CREATE UNIQUE INDEX "tenant_notification_settings_tenant_id_event_key_key"
    ON "tenant_notification_settings"("tenant_id", "event_key");

CREATE UNIQUE INDEX "user_notification_settings_tenant_id_user_id_event_key_channel_key"
    ON "user_notification_settings"("tenant_id", "user_id", "event_key", "channel");

-- Índices de consulta frecuente
CREATE INDEX "tenant_notification_settings_tenant_id_idx"
    ON "tenant_notification_settings"("tenant_id");

CREATE INDEX "user_notification_settings_tenant_id_event_key_idx"
    ON "user_notification_settings"("tenant_id", "event_key");

CREATE INDEX "user_notification_settings_user_id_idx"
    ON "user_notification_settings"("user_id");

-- Claves foráneas
ALTER TABLE "tenant_notification_settings"
    ADD CONSTRAINT "tenant_notification_settings_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_notification_settings"
    ADD CONSTRAINT "user_notification_settings_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_notification_settings"
    ADD CONSTRAINT "user_notification_settings_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
