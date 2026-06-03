-- Migration: init_fault_reports_module
-- Módulo 3: Registro de Fallas (FaultReport)

-- 1. Agregar valor al enum MeterLogSource
ALTER TYPE "MeterLogSource" ADD VALUE IF NOT EXISTS 'FAULT_REPORT';

-- 2. Nuevos enums del módulo de fallas
CREATE TYPE "AffectedSystem" AS ENUM (
  'MOTOR',
  'HYDRAULIC',
  'ELECTRICAL',
  'POWER_TRAIN',
  'STRUCTURE',
  'GET_WEAR',
  'TIRES_TRACKS'
);

CREATE TYPE "FaultCriticality" AS ENUM (
  'HIGH',
  'MEDIUM',
  'LOW'
);

CREATE TYPE "FaultReportStatus" AS ENUM (
  'OPEN',
  'LINKED',
  'CLOSED'
);

-- 3. Tabla principal fault_reports
CREATE TABLE "fault_reports" (
  "id"                   UUID         NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"            UUID         NOT NULL,
  "contract_id"          UUID         NOT NULL,
  "equipment_id"         UUID         NOT NULL,
  "reported_by_id"       UUID         NOT NULL,
  "correlative"          VARCHAR(30)  NOT NULL,
  "event_date"           TIMESTAMP(3) NOT NULL,
  "meter_at_fault"       INTEGER,
  "affected_system"      "AffectedSystem" NOT NULL,
  "criticality"          "FaultCriticality" NOT NULL,
  "symptom_description"  TEXT         NOT NULL,
  "status"               "FaultReportStatus" NOT NULL DEFAULT 'OPEN',
  "work_order_id"        UUID,
  "created_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"           TIMESTAMP(3) NOT NULL,

  CONSTRAINT "fault_reports_pkey" PRIMARY KEY ("id")
);

-- 4. Constraints de unicidad
ALTER TABLE "fault_reports"
  ADD CONSTRAINT "fault_reports_tenant_id_correlative_key"
  UNIQUE ("tenant_id", "correlative");

ALTER TABLE "fault_reports"
  ADD CONSTRAINT "fault_reports_work_order_id_key"
  UNIQUE ("work_order_id");

-- 5. Índices operacionales
CREATE INDEX "fault_reports_tenant_id_equipment_id_idx"
  ON "fault_reports"("tenant_id", "equipment_id");

CREATE INDEX "fault_reports_tenant_id_criticality_status_idx"
  ON "fault_reports"("tenant_id", "criticality", "status");

CREATE INDEX "fault_reports_tenant_id_event_date_idx"
  ON "fault_reports"("tenant_id", "event_date");

-- 6. Foreign keys
ALTER TABLE "fault_reports"
  ADD CONSTRAINT "fault_reports_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "fault_reports"
  ADD CONSTRAINT "fault_reports_contract_id_fkey"
  FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "fault_reports"
  ADD CONSTRAINT "fault_reports_equipment_id_fkey"
  FOREIGN KEY ("equipment_id") REFERENCES "equipments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "fault_reports"
  ADD CONSTRAINT "fault_reports_reported_by_id_fkey"
  FOREIGN KEY ("reported_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "fault_reports"
  ADD CONSTRAINT "fault_reports_work_order_id_fkey"
  FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
