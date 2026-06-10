-- Migration: init_equipment_availability
-- Módulo de Disponibilidad Operativa Diaria
-- Fecha: 2026-06-02

-- 1. Nuevo valor en enum MeterLogSource (trazabilidad de horómetro desde reportes de turno)
ALTER TYPE "MeterLogSource" ADD VALUE IF NOT EXISTS 'AVAILABILITY_REPORT';

-- 2. Enum: tipo de turno
CREATE TYPE "ShiftType" AS ENUM ('DAY', 'NIGHT');

-- 3. Enum: estado operativo declarado en el reporte
CREATE TYPE "OperationalStatus" AS ENUM (
  'OPERATIONAL',
  'STANDBY',
  'RESERVE_NO_OPERATOR',
  'DOWN_FAILURE',
  'DOWN_MAINTENANCE'
);

-- 4. Tabla principal: reportes de disponibilidad por turno
-- Nota: ADD VALUE a un enum no puede usarse en la misma transacción implícita;
-- PostgreSQL lo maneja correctamente en migraciones separadas.
CREATE TABLE "equipment_availabilities" (
    "id"             UUID        NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id"      UUID        NOT NULL,
    "contract_id"    UUID,
    "equipment_id"   UUID        NOT NULL,
    "reported_by_id" UUID        NOT NULL,
    "report_date"    DATE        NOT NULL,
    "shift"          "ShiftType" NOT NULL,
    "status"         "OperationalStatus" NOT NULL,
    "meter_reading"  INTEGER,
    "comments"       VARCHAR(500),
    "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"     TIMESTAMP(3) NOT NULL,

    CONSTRAINT "equipment_availabilities_pkey" PRIMARY KEY ("id")
);

-- 5. Restricción de negocio: un equipo solo puede tener un reporte por fecha y turno
ALTER TABLE "equipment_availabilities"
    ADD CONSTRAINT "equipment_availabilities_tenant_id_equipment_id_report_date_shift_key"
    UNIQUE ("tenant_id", "equipment_id", "report_date", "shift");

-- 6. Índices para las consultas críticas
CREATE INDEX "equipment_availabilities_tenant_id_report_date_shift_idx"
    ON "equipment_availabilities"("tenant_id", "report_date", "shift");

CREATE INDEX "equipment_availabilities_tenant_id_equipment_id_idx"
    ON "equipment_availabilities"("tenant_id", "equipment_id");

-- 7. Claves foráneas
ALTER TABLE "equipment_availabilities"
    ADD CONSTRAINT "equipment_availabilities_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "equipment_availabilities"
    ADD CONSTRAINT "equipment_availabilities_contract_id_fkey"
    FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "equipment_availabilities"
    ADD CONSTRAINT "equipment_availabilities_equipment_id_fkey"
    FOREIGN KEY ("equipment_id") REFERENCES "equipments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "equipment_availabilities"
    ADD CONSTRAINT "equipment_availabilities_reported_by_id_fkey"
    FOREIGN KEY ("reported_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
