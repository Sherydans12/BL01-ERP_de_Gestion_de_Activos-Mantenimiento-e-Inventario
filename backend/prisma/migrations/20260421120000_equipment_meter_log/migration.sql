-- CreateEnum
CREATE TYPE "MeterLogSource" AS ENUM ('OT', 'MANUAL', 'TELEMETRY');

-- CreateTable
CREATE TABLE "equipment_meter_logs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "equipment_id" UUID NOT NULL,
    "old_value" DECIMAL(14,4) NOT NULL,
    "new_value" DECIMAL(14,4) NOT NULL,
    "source" "MeterLogSource" NOT NULL,
    "source_id" VARCHAR(80),
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_id" UUID NOT NULL,

    CONSTRAINT "equipment_meter_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "equipment_meter_logs_tenant_id_equipment_id_date_idx" ON "equipment_meter_logs"("tenant_id", "equipment_id", "date");

-- AddForeignKey
ALTER TABLE "equipment_meter_logs" ADD CONSTRAINT "equipment_meter_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_meter_logs" ADD CONSTRAINT "equipment_meter_logs_equipment_id_fkey" FOREIGN KEY ("equipment_id") REFERENCES "equipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_meter_logs" ADD CONSTRAINT "equipment_meter_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
