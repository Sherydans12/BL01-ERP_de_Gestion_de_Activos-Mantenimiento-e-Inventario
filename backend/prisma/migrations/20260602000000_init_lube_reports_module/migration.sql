-- Migration: init_lube_reports_module
-- Date: 2026-06-02
-- Description: Adds LUBE_DISPATCH to AssetCostType enum and creates lube_reports / lube_report_lines tables
--              for the Lubricant Consumption Report module.

-- 1. Extend enum AssetCostType with new value
ALTER TYPE "AssetCostType" ADD VALUE 'LUBE_DISPATCH';

-- 2. Create lube_reports table
CREATE TABLE "lube_reports" (
    "id"           UUID         NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id"    UUID         NOT NULL,
    "contract_id"  UUID         NOT NULL,
    "equipment_id" UUID         NOT NULL,
    "warehouse_id" UUID         NOT NULL,
    "user_id"      UUID         NOT NULL,
    "correlative"  VARCHAR(30)  NOT NULL,
    "dispatch_date" TIMESTAMP(3) NOT NULL,
    "meter_reading" INTEGER,
    "notes"        TEXT,
    "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lube_reports_pkey" PRIMARY KEY ("id")
);

-- 3. Create lube_report_lines table
CREATE TABLE "lube_report_lines" (
    "id"        UUID           NOT NULL DEFAULT gen_random_uuid(),
    "report_id" UUID           NOT NULL,
    "item_id"   UUID           NOT NULL,
    "quantity"  DOUBLE PRECISION NOT NULL,
    "unit_cost" DECIMAL(18, 4) NOT NULL,

    CONSTRAINT "lube_report_lines_pkey" PRIMARY KEY ("id")
);

-- 4. Indexes on lube_reports
CREATE INDEX "lube_reports_tenant_id_dispatch_date_idx" ON "lube_reports"("tenant_id", "dispatch_date");
CREATE INDEX "lube_reports_tenant_id_equipment_id_idx" ON "lube_reports"("tenant_id", "equipment_id");

-- 5. Foreign keys on lube_reports
ALTER TABLE "lube_reports" ADD CONSTRAINT "lube_reports_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "lube_reports" ADD CONSTRAINT "lube_reports_contract_id_fkey"
    FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "lube_reports" ADD CONSTRAINT "lube_reports_equipment_id_fkey"
    FOREIGN KEY ("equipment_id") REFERENCES "equipments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "lube_reports" ADD CONSTRAINT "lube_reports_warehouse_id_fkey"
    FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "lube_reports" ADD CONSTRAINT "lube_reports_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 6. Foreign keys on lube_report_lines
ALTER TABLE "lube_report_lines" ADD CONSTRAINT "lube_report_lines_report_id_fkey"
    FOREIGN KEY ("report_id") REFERENCES "lube_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "lube_report_lines" ADD CONSTRAINT "lube_report_lines_item_id_fkey"
    FOREIGN KEY ("item_id") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
