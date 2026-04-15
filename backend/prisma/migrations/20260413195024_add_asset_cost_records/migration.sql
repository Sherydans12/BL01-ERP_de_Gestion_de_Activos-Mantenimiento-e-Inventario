-- CreateEnum
CREATE TYPE "AssetCostType" AS ENUM ('PURCHASE');

-- CreateTable
CREATE TABLE "asset_cost_records" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "equipment_id" UUID NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "type" "AssetCostType" NOT NULL,
    "reference_id" UUID NOT NULL,
    "warehouse_receipt_id" UUID,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_cost_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "asset_cost_records_warehouse_receipt_id_key" ON "asset_cost_records"("warehouse_receipt_id");

-- CreateIndex
CREATE INDEX "asset_cost_records_tenant_id_equipment_id_idx" ON "asset_cost_records"("tenant_id", "equipment_id");

-- CreateIndex
CREATE INDEX "asset_cost_records_tenant_id_recorded_at_idx" ON "asset_cost_records"("tenant_id", "recorded_at");

-- AddForeignKey
ALTER TABLE "asset_cost_records" ADD CONSTRAINT "asset_cost_records_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_cost_records" ADD CONSTRAINT "asset_cost_records_equipment_id_fkey" FOREIGN KEY ("equipment_id") REFERENCES "equipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_cost_records" ADD CONSTRAINT "asset_cost_records_reference_id_fkey" FOREIGN KEY ("reference_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_cost_records" ADD CONSTRAINT "asset_cost_records_warehouse_receipt_id_fkey" FOREIGN KEY ("warehouse_receipt_id") REFERENCES "warehouse_receipts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
