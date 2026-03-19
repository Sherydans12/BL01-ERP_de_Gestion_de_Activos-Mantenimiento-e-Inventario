/*
  Warnings:

  - The values [ABIERTA,EN_REVISION,CERRADA] on the enum `OtStatus` will be removed. If these variants are still used in the database, this will fail.
  - A unique constraint covering the columns `[tenant_id,code]` on the table `catalog_items` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[tenant_id,internal_id]` on the table `equipments` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[tenant_id,plate]` on the table `equipments` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[tenant_id,vin]` on the table `equipments` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[tenant_id,correlative]` on the table `work_orders` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `tenant_id` to the `catalog_items` table without a default value. This is not possible if the table is not empty.
  - Added the required column `tenant_id` to the `equipments` table without a default value. This is not possible if the table is not empty.
  - Added the required column `maintenance_type` to the `work_orders` table without a default value. This is not possible if the table is not empty.
  - Added the required column `tenant_id` to the `work_orders` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "MaintenanceType" AS ENUM ('PREVENTIVO', 'CORRECTIVO');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'SUPERVISOR', 'MECHANIC');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CatalogCategory" ADD VALUE 'FUEL_TYPE';
ALTER TYPE "CatalogCategory" ADD VALUE 'DRIVE_TYPE';
ALTER TYPE "CatalogCategory" ADD VALUE 'OWNERSHIP';

-- AlterEnum
BEGIN;
CREATE TYPE "OtStatus_new" AS ENUM ('OPEN', 'IN_PROGRESS', 'ON_HOLD', 'CLOSED');
ALTER TABLE "public"."work_orders" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "work_orders" ALTER COLUMN "status" TYPE "OtStatus_new" USING ("status"::text::"OtStatus_new");
ALTER TYPE "OtStatus" RENAME TO "OtStatus_old";
ALTER TYPE "OtStatus_new" RENAME TO "OtStatus";
DROP TYPE "public"."OtStatus_old";
ALTER TABLE "work_orders" ALTER COLUMN "status" SET DEFAULT 'OPEN';
COMMIT;

-- DropIndex
DROP INDEX "catalog_items_code_key";

-- DropIndex
DROP INDEX "equipments_internal_id_key";

-- DropIndex
DROP INDEX "work_orders_correlative_key";

-- AlterTable
ALTER TABLE "catalog_items" ADD COLUMN     "tenant_id" UUID NOT NULL;

-- AlterTable
ALTER TABLE "equipments" ADD COLUMN     "drive_type" VARCHAR(50),
ADD COLUMN     "engine_number" VARCHAR(50),
ADD COLUMN     "fuel_type" VARCHAR(50),
ADD COLUMN     "initial_horometer" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "maintenance_frequency" INTEGER,
ADD COLUMN     "ownership" VARCHAR(50),
ADD COLUMN     "tenant_id" UUID NOT NULL,
ADD COLUMN     "vin" VARCHAR(50),
ADD COLUMN     "year" INTEGER;

-- AlterTable
ALTER TABLE "work_orders" ADD COLUMN     "closed_at" TIMESTAMP(3),
ADD COLUMN     "maintenance_type" "MaintenanceType" NOT NULL,
ADD COLUMN     "tenant_id" UUID NOT NULL,
ALTER COLUMN "status" SET DEFAULT 'OPEN';

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(100) NOT NULL,
    "password" VARCHAR(255) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'MECHANIC',
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "activation_token" VARCHAR(255),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "tenant_id" UUID,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "logo_url" VARCHAR(255),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_code_key" ON "tenants"("code");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_items_tenant_id_code_key" ON "catalog_items"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "equipments_tenant_id_internal_id_key" ON "equipments"("tenant_id", "internal_id");

-- CreateIndex
CREATE UNIQUE INDEX "equipments_tenant_id_plate_key" ON "equipments"("tenant_id", "plate");

-- CreateIndex
CREATE UNIQUE INDEX "equipments_tenant_id_vin_key" ON "equipments"("tenant_id", "vin");

-- CreateIndex
CREATE UNIQUE INDEX "work_orders_tenant_id_correlative_key" ON "work_orders"("tenant_id", "correlative");

-- AddForeignKey
ALTER TABLE "equipments" ADD CONSTRAINT "equipments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
