-- Migration: add_availability_events
-- Modelo híbrido Snapshot + Event Ledger para disponibilidad M2.
-- Fecha: 2026-06-08

-- 1. Enum de origen del evento.
CREATE TYPE "AvailabilityEventSource" AS ENUM (
  'MANUAL',
  'OT',
  'FAULT_REPORT',
  'LEGACY_SNAPSHOT'
);

-- 2. Tabla ledger. El snapshot canónico sigue siendo equipment_availabilities.
CREATE TABLE "availability_events" (
  "id"               UUID                      NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"        UUID                      NOT NULL,
  "availability_id"  UUID                      NOT NULL,
  "equipment_id"     UUID                      NOT NULL,
  "reported_by_id"   UUID,
  "status"           "OperationalStatus"       NOT NULL,
  "previous_status"  "OperationalStatus",
  "meter_reading"    INTEGER,
  "comments"         VARCHAR(500),
  "event_at"         TIMESTAMP(3)              NOT NULL,
  "source"           "AvailabilityEventSource" NOT NULL DEFAULT 'MANUAL',
  "elapsed_minutes"  INTEGER,
  "created_at"       TIMESTAMP(3)              NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "availability_events_pkey" PRIMARY KEY ("id")
);

-- 3. Índices operacionales.
CREATE INDEX "availability_events_tenant_id_equipment_id_event_at_idx"
  ON "availability_events"("tenant_id", "equipment_id", "event_at");

CREATE INDEX "availability_events_tenant_id_availability_id_event_at_idx"
  ON "availability_events"("tenant_id", "availability_id", "event_at");

-- Evita duplicar el backfill legacy si la migración se reintenta manualmente.
CREATE UNIQUE INDEX "availability_events_legacy_snapshot_unique"
  ON "availability_events"("availability_id")
  WHERE "source" = 'LEGACY_SNAPSHOT';

-- 4. Foreign keys.
ALTER TABLE "availability_events"
  ADD CONSTRAINT "availability_events_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "availability_events"
  ADD CONSTRAINT "availability_events_availability_id_fkey"
  FOREIGN KEY ("availability_id") REFERENCES "equipment_availabilities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "availability_events"
  ADD CONSTRAINT "availability_events_equipment_id_fkey"
  FOREIGN KEY ("equipment_id") REFERENCES "equipments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "availability_events"
  ADD CONSTRAINT "availability_events_reported_by_id_fkey"
  FOREIGN KEY ("reported_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 5. Backfill idempotente: cada snapshot existente genera un evento legacy.
INSERT INTO "availability_events" (
  "tenant_id",
  "availability_id",
  "equipment_id",
  "reported_by_id",
  "status",
  "previous_status",
  "meter_reading",
  "comments",
  "event_at",
  "source",
  "elapsed_minutes",
  "created_at"
)
SELECT
  ea."tenant_id",
  ea."id",
  ea."equipment_id",
  ea."reported_by_id",
  ea."status",
  NULL,
  ea."meter_reading",
  ea."comments",
  ea."created_at",
  'LEGACY_SNAPSHOT',
  NULL,
  CURRENT_TIMESTAMP
FROM "equipment_availabilities" ea
WHERE NOT EXISTS (
  SELECT 1
  FROM "availability_events" ev
  WHERE ev."availability_id" = ea."id"
    AND ev."source" = 'LEGACY_SNAPSHOT'
);
