-- ============================================================
-- Migration: Inventory-First P2P Integration
-- ============================================================

-- 1. New enum: WarehouseType
CREATE TYPE "WarehouseType" AS ENUM ('PHYSICAL', 'VIRTUAL', 'TRANSIT');

-- 2. Expand TransactionType enum
ALTER TYPE "TransactionType" ADD VALUE IF NOT EXISTS 'PURCHASE_RECEIPT';
ALTER TYPE "TransactionType" ADD VALUE IF NOT EXISTS 'WORK_ORDER_ISSUE';

-- 3. Expand AssetCostType enum
ALTER TYPE "AssetCostType" ADD VALUE IF NOT EXISTS 'WORK_ORDER';

-- 4. Create item_categories table
CREATE TABLE "item_categories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    CONSTRAINT "item_categories_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "item_categories_tenant_id_name_key" ON "item_categories"("tenant_id", "name");

ALTER TABLE "item_categories"
    ADD CONSTRAINT "item_categories_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 5. Migrate existing category strings into item_categories per tenant
INSERT INTO "item_categories" ("id", "tenant_id", "name")
SELECT gen_random_uuid(), "tenant_id", "category"
FROM "inventory_items"
WHERE "category" IS NOT NULL
GROUP BY "tenant_id", "category";

-- 6. Add categoryId FK and classification flags to inventory_items
ALTER TABLE "inventory_items"
    ADD COLUMN "category_id" UUID,
    ADD COLUMN "is_inventory" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "is_asset" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "is_consumable" BOOLEAN NOT NULL DEFAULT true;

-- Populate categoryId from migrated data
UPDATE "inventory_items" ii
SET "category_id" = ic."id"
FROM "item_categories" ic
WHERE ic."tenant_id" = ii."tenant_id" AND ic."name" = ii."category";

-- Make old category column nullable (it was NOT NULL before)
ALTER TABLE "inventory_items" ALTER COLUMN "category" DROP NOT NULL;

ALTER TABLE "inventory_items"
    ADD CONSTRAINT "inventory_items_category_id_fkey"
    FOREIGN KEY ("category_id") REFERENCES "item_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 7. Add type column to warehouses
ALTER TABLE "warehouses" ADD COLUMN "type" "WarehouseType" NOT NULL DEFAULT 'PHYSICAL';

-- 8. Create warehouse_bins table
CREATE TABLE "warehouse_bins" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "warehouse_id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "label" VARCHAR(100),
    CONSTRAINT "warehouse_bins_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "warehouse_bins_warehouse_id_code_key" ON "warehouse_bins"("warehouse_id", "code");

ALTER TABLE "warehouse_bins"
    ADD CONSTRAINT "warehouse_bins_warehouse_id_fkey"
    FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 9. Update item_stocks: change unitCost precision, add bin_id
ALTER TABLE "item_stocks" ADD COLUMN "bin_id" UUID;

ALTER TABLE "item_stocks"
    ALTER COLUMN "unit_cost" TYPE DECIMAL(18, 4) USING "unit_cost"::DECIMAL(18, 4);

ALTER TABLE "item_stocks"
    ADD CONSTRAINT "item_stocks_bin_id_fkey"
    FOREIGN KEY ("bin_id") REFERENCES "warehouse_bins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 10. Restructure asset_cost_records: dual FK approach
--     Rename reference_id -> purchase_order_id, add work_order_id
ALTER TABLE "asset_cost_records" DROP CONSTRAINT IF EXISTS "asset_cost_records_reference_id_fkey";

ALTER TABLE "asset_cost_records" RENAME COLUMN "reference_id" TO "purchase_order_id";

ALTER TABLE "asset_cost_records" ADD COLUMN "work_order_id" UUID;

ALTER TABLE "asset_cost_records" ALTER COLUMN "purchase_order_id" DROP NOT NULL;

ALTER TABLE "asset_cost_records"
    ADD CONSTRAINT "asset_cost_records_purchase_order_id_fkey"
    FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "asset_cost_records"
    ADD CONSTRAINT "asset_cost_records_work_order_id_fkey"
    FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Drop the old onDelete Restrict constraint on warehouse_receipt too and recreate as SetNull
ALTER TABLE "asset_cost_records" DROP CONSTRAINT IF EXISTS "asset_cost_records_warehouse_receipt_id_fkey";

ALTER TABLE "asset_cost_records"
    ADD CONSTRAINT "asset_cost_records_warehouse_receipt_id_fkey"
    FOREIGN KEY ("warehouse_receipt_id") REFERENCES "warehouse_receipts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
