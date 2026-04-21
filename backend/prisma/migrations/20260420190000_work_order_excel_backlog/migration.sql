-- Enums (formulario operacional OT)
CREATE TYPE "AvailabilityImpact" AS ENUM ('SI', 'NO', 'STP');
CREATE TYPE "EquipmentWorkLocation" AS ENUM ('TALLER', 'TERRENO');
CREATE TYPE "WorkShift" AS ENUM ('DIA', 'NOCHE');
CREATE TYPE "FluidCompartment" AS ENUM (
  'MOTOR',
  'TRANSMISION',
  'DIRECCION',
  'HIDRAULICO',
  'MANDOS',
  'DIFERENCIAL',
  'REFRIGERANTE',
  'OTROS'
);
CREATE TYPE "BacklogStatus" AS ENUM ('PENDING', 'DONE');

ALTER TABLE "equipments" ADD COLUMN IF NOT EXISTS "pm_interval_override" INTEGER;

ALTER TABLE "work_orders"
  ADD COLUMN IF NOT EXISTS "maintenance_order_number" VARCHAR(80),
  ADD COLUMN IF NOT EXISTS "detention_started_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "detention_ended_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "detention_initial_meter" INTEGER,
  ADD COLUMN IF NOT EXISTS "detention_final_meter" INTEGER,
  ADD COLUMN IF NOT EXISTS "mechanic_attention_date" DATE,
  ADD COLUMN IF NOT EXISTS "mechanic_attention_from_time" VARCHAR(8),
  ADD COLUMN IF NOT EXISTS "mechanic_attention_to_time" VARCHAR(8),
  ADD COLUMN IF NOT EXISTS "client_attributed_start" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "client_attributed_end" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "client_attributed_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "affects_availability" "AvailabilityImpact",
  ADD COLUMN IF NOT EXISTS "classification_tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "work_location" "EquipmentWorkLocation",
  ADD COLUMN IF NOT EXISTS "metric_hm" DECIMAL(14, 4),
  ADD COLUMN IF NOT EXISTS "metric_hh" DECIMAL(14, 4),
  ADD COLUMN IF NOT EXISTS "work_shift" "WorkShift",
  ADD COLUMN IF NOT EXISTS "initial_request_description" TEXT,
  ADD COLUMN IF NOT EXISTS "intervened_systems_json" JSONB,
  ADD COLUMN IF NOT EXISTS "symptoms_text" TEXT,
  ADD COLUMN IF NOT EXISTS "cause_text" TEXT,
  ADD COLUMN IF NOT EXISTS "work_performed_description" TEXT,
  ADD COLUMN IF NOT EXISTS "technicians_names" TEXT,
  ADD COLUMN IF NOT EXISTS "responsible_mechanic_name" VARCHAR(150),
  ADD COLUMN IF NOT EXISTS "responsible_mechanic_signature" VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "shift_supervisor_name" VARCHAR(150),
  ADD COLUMN IF NOT EXISTS "shift_supervisor_signature" VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "pm_cycle_number" INTEGER;

CREATE TABLE IF NOT EXISTS "work_order_backlog_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "work_order_id" UUID NOT NULL,
  "description" TEXT NOT NULL,
  "status" "BacklogStatus" NOT NULL DEFAULT 'PENDING',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "work_order_backlog_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "work_order_backlog_items_tenant_id_status_idx"
  ON "work_order_backlog_items" ("tenant_id", "status");

ALTER TABLE "work_order_backlog_items"
  ADD CONSTRAINT "work_order_backlog_items_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "work_order_backlog_items"
  ADD CONSTRAINT "work_order_backlog_items_work_order_id_fkey"
  FOREIGN KEY ("work_order_id") REFERENCES "work_orders" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "work_order_fluid_compartments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "work_order_id" UUID NOT NULL,
  "compartment" "FluidCompartment" NOT NULL,
  "fluid_type" VARCHAR(200) NOT NULL,
  "liters" DECIMAL(14, 4) NOT NULL,
  "action" "FluidAction" NOT NULL,

  CONSTRAINT "work_order_fluid_compartments_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "work_order_fluid_compartments"
  ADD CONSTRAINT "work_order_fluid_compartments_work_order_id_fkey"
  FOREIGN KEY ("work_order_id") REFERENCES "work_orders" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
