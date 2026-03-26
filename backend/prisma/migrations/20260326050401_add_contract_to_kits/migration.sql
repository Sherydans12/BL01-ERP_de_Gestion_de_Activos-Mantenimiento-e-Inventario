-- AlterTable
ALTER TABLE "maintenance_kits" ADD COLUMN     "contract_id" UUID;

-- AddForeignKey
ALTER TABLE "maintenance_kits" ADD CONSTRAINT "maintenance_kits_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
