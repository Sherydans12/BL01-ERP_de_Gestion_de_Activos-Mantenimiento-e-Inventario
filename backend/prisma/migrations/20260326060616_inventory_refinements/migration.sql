/*
  Warnings:

  - You are about to drop the column `cost_price` on the `inventory_items` table. All the data in the column will be lost.
  - Changed the type of `category` on the `inventory_items` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- AlterTable
ALTER TABLE "inventory_items" DROP COLUMN "cost_price",
ADD COLUMN     "is_serialized" BOOLEAN NOT NULL DEFAULT false,
DROP COLUMN "category",
ADD COLUMN     "category" VARCHAR(50) NOT NULL;

-- AlterTable
ALTER TABLE "item_stocks" ADD COLUMN     "unit_cost" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "warehouses" ADD COLUMN     "subcontract_id" UUID;

-- DropEnum
DROP TYPE "ItemCategory";

-- AddForeignKey
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_subcontract_id_fkey" FOREIGN KEY ("subcontract_id") REFERENCES "subcontracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
