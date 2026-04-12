-- AlterTable
ALTER TABLE "purchase_orders" ADD COLUMN     "subcontract_id" UUID;

-- AlterTable
ALTER TABLE "purchase_requisitions" ADD COLUMN     "subcontract_id" UUID;

-- AddForeignKey
ALTER TABLE "purchase_requisitions" ADD CONSTRAINT "purchase_requisitions_subcontract_id_fkey" FOREIGN KEY ("subcontract_id") REFERENCES "subcontracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_subcontract_id_fkey" FOREIGN KEY ("subcontract_id") REFERENCES "subcontracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
