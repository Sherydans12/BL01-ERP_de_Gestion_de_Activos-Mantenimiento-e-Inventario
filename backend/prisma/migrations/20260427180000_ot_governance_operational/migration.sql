-- OT gobierno: categoría no plan preventiva, equipo operativo/acumulado, auditoría OT, participantes/supervisor

ALTER TYPE "OtCategory" ADD VALUE 'NO_PROGRAMADA_PREVENTIVO';

ALTER TABLE "equipments" ADD COLUMN IF NOT EXISTS "is_operational" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "equipments" ADD COLUMN IF NOT EXISTS "cumulative_downtime_hours" DECIMAL(14,4) NOT NULL DEFAULT 0;

ALTER TABLE "work_orders" ADD COLUMN IF NOT EXISTS "created_by_user_id" UUID;
ALTER TABLE "work_orders" ADD COLUMN IF NOT EXISTS "in_progress_at" TIMESTAMP(3);
ALTER TABLE "work_orders" ADD COLUMN IF NOT EXISTS "closure_equipment_operational" BOOLEAN;
ALTER TABLE "work_orders" ADD COLUMN IF NOT EXISTS "participant_user_ids" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "work_orders" ADD COLUMN IF NOT EXISTS "shift_supervisor_user_id" UUID;

ALTER TABLE "work_orders" DROP CONSTRAINT IF EXISTS "work_orders_created_by_user_id_fkey";
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "work_orders" DROP CONSTRAINT IF EXISTS "work_orders_shift_supervisor_user_id_fkey";
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_shift_supervisor_user_id_fkey"
  FOREIGN KEY ("shift_supervisor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
