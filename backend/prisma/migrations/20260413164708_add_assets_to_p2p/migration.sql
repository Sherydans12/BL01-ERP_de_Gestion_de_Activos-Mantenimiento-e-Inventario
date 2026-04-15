-- AlterTable
ALTER TABLE "purchase_orders" ADD COLUMN     "equipment_id" UUID,
ADD COLUMN     "work_order_id" UUID;

-- AlterTable
ALTER TABLE "purchase_requisitions" ADD COLUMN     "equipment_id" UUID,
ADD COLUMN     "work_order_id" UUID;

-- CreateIndex
CREATE INDEX "purchase_orders_tenant_id_equipment_id_idx" ON "purchase_orders"("tenant_id", "equipment_id");

-- CreateIndex
CREATE INDEX "purchase_orders_tenant_id_work_order_id_idx" ON "purchase_orders"("tenant_id", "work_order_id");

-- CreateIndex
CREATE INDEX "purchase_requisitions_tenant_id_equipment_id_idx" ON "purchase_requisitions"("tenant_id", "equipment_id");

-- CreateIndex
CREATE INDEX "purchase_requisitions_tenant_id_work_order_id_idx" ON "purchase_requisitions"("tenant_id", "work_order_id");

-- AddForeignKey
ALTER TABLE "purchase_requisitions" ADD CONSTRAINT "purchase_requisitions_equipment_id_fkey" FOREIGN KEY ("equipment_id") REFERENCES "equipments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requisitions" ADD CONSTRAINT "purchase_requisitions_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_equipment_id_fkey" FOREIGN KEY ("equipment_id") REFERENCES "equipments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
