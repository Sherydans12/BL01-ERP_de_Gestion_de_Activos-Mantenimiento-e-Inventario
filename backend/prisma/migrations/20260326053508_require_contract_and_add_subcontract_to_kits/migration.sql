/*
  Warnings:

  - Made the column `contract_id` on table `maintenance_kits` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "maintenance_kits" ADD COLUMN     "subcontract_id" UUID,
ALTER COLUMN "contract_id" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "maintenance_kits" ADD CONSTRAINT "maintenance_kits_subcontract_id_fkey" FOREIGN KEY ("subcontract_id") REFERENCES "subcontracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
