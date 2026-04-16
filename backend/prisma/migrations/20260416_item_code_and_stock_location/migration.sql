-- AlterTable
ALTER TABLE "inventory_items" ADD COLUMN "inventory_code" VARCHAR(60);

-- CreateIndex
CREATE INDEX "inventory_items_tenant_id_inventory_code_idx" ON "inventory_items"("tenant_id", "inventory_code");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_items_tenant_id_inventory_code_key" ON "inventory_items"("tenant_id", "inventory_code");

-- Rename physical shelf column to location (per-warehouse coordinates)
ALTER TABLE "item_stocks" RENAME COLUMN "shelf_location" TO "location";
ALTER TABLE "item_stocks" ALTER COLUMN "location" TYPE VARCHAR(120);
