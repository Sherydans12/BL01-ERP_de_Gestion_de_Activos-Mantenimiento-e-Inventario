-- CreateEnum
CREATE TYPE "CatalogCategory" AS ENUM ('EQUIPMENT_TYPE', 'BRAND', 'SYSTEM', 'FLUID', 'FUEL_TYPE', 'DRIVE_TYPE', 'OWNERSHIP');

-- CreateEnum
CREATE TYPE "OtType" AS ENUM ('NUEVA', 'CONTINUIDAD');

-- CreateEnum
CREATE TYPE "OtCategory" AS ENUM ('PROGRAMADA', 'NO_PROGRAMADA_CORRECTIVA', 'NO_PROGRAMADA_REACTIVA');

-- CreateEnum
CREATE TYPE "MeterType" AS ENUM ('HOURS', 'KILOMETERS');

-- CreateEnum
CREATE TYPE "MaintenanceType" AS ENUM ('PREVENTIVO', 'CORRECTIVO');

-- CreateEnum
CREATE TYPE "OtStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'ON_HOLD', 'CLOSED');

-- CreateEnum
CREATE TYPE "FluidAction" AS ENUM ('RELLENO', 'CAMBIO');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'SUPERVISOR', 'MECHANIC');

-- CreateEnum
CREATE TYPE "BackgroundPreference" AS ENUM ('DARK', 'LIGHT');

-- CreateTable
CREATE TABLE "equipments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "contract_id" UUID,
    "subcontract_id" UUID,
    "mine_internal_id" VARCHAR(50),
    "internal_id" VARCHAR(50) NOT NULL,
    "plate" VARCHAR(20),
    "type" VARCHAR(50) NOT NULL,
    "brand" VARCHAR(50) NOT NULL,
    "model" VARCHAR(50) NOT NULL,
    "meter_type" "MeterType" NOT NULL DEFAULT 'HOURS',
    "initial_meter" INTEGER NOT NULL DEFAULT 0,
    "current_meter" INTEGER NOT NULL DEFAULT 0,
    "vin" VARCHAR(50),
    "engine_number" VARCHAR(50),
    "year" INTEGER,
    "fuel_type" VARCHAR(50),
    "drive_type" VARCHAR(50),
    "ownership" VARCHAR(50),
    "maintenance_frequency" INTEGER,
    "last_maintenance_date" DATE,
    "last_maintenance_meter" INTEGER,
    "last_maintenance_type" VARCHAR(100),
    "tech_review_exp" DATE,
    "circ_permit_exp" DATE,
    "soap_exp" DATE,
    "mechanical_cert_exp" DATE,
    "liability_policy_exp" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "equipments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_items" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "category" "CatalogCategory" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "catalog_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_orders" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "subcontract_id" UUID,
    "correlative" VARCHAR(30) NOT NULL,
    "equipment_id" UUID NOT NULL,
    "type" "OtType" NOT NULL DEFAULT 'NUEVA',
    "category" "OtCategory" NOT NULL,
    "maintenance_type" "MaintenanceType" NOT NULL,
    "status" "OtStatus" NOT NULL DEFAULT 'OPEN',
    "responsible" VARCHAR(100),
    "initial_meter" INTEGER NOT NULL,
    "final_meter" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "has_backlog" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "synced_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),

    CONSTRAINT "work_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_order_systems" (
    "work_order_id" UUID NOT NULL,
    "catalog_item_id" UUID NOT NULL,

    CONSTRAINT "work_order_systems_pkey" PRIMARY KEY ("work_order_id","catalog_item_id")
);

-- CreateTable
CREATE TABLE "work_order_fluids" (
    "id" UUID NOT NULL,
    "work_order_id" UUID NOT NULL,
    "catalog_item_id" UUID NOT NULL,
    "liters" DOUBLE PRECISION NOT NULL,
    "action" "FluidAction" NOT NULL,

    CONSTRAINT "work_order_fluids_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(100) NOT NULL,
    "password" VARCHAR(255) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'MECHANIC',
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "activation_token" VARCHAR(255),
    "reset_password_token" VARCHAR(255),
    "reset_password_expires" TIMESTAMP(3),
    "rut" VARCHAR(20),
    "phone" VARCHAR(20),
    "birth_date" DATE,
    "position" VARCHAR(100),
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
    "rut" VARCHAR(20),
    "address" VARCHAR(255),
    "phone" VARCHAR(20),
    "logo_url" VARCHAR(255),
    "primary_color" VARCHAR(50) NOT NULL DEFAULT '#FF3366',
    "background_preference" "BackgroundPreference" NOT NULL DEFAULT 'DARK',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contracts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subcontracts" (
    "id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subcontracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_contracts" (
    "user_id" UUID NOT NULL,
    "contract_id" UUID NOT NULL,

    CONSTRAINT "user_contracts_pkey" PRIMARY KEY ("user_id","contract_id")
);

-- CreateTable
CREATE TABLE "work_order_tasks" (
    "id" UUID NOT NULL,
    "work_order_id" UUID NOT NULL,
    "description" VARCHAR(255) NOT NULL,
    "is_completed" BOOLEAN NOT NULL DEFAULT false,
    "observation" TEXT,
    "measurement" DOUBLE PRECISION,

    CONSTRAINT "work_order_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_order_parts" (
    "id" UUID NOT NULL,
    "work_order_id" UUID NOT NULL,
    "inventory_item_id" UUID,
    "part_number" VARCHAR(50) NOT NULL,
    "description" VARCHAR(100) NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,

    CONSTRAINT "work_order_parts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "equipments_tenant_id_internal_id_key" ON "equipments"("tenant_id", "internal_id");

-- CreateIndex
CREATE UNIQUE INDEX "equipments_tenant_id_plate_key" ON "equipments"("tenant_id", "plate");

-- CreateIndex
CREATE UNIQUE INDEX "equipments_tenant_id_vin_key" ON "equipments"("tenant_id", "vin");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_items_tenant_id_code_key" ON "catalog_items"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "work_orders_tenant_id_correlative_key" ON "work_orders"("tenant_id", "correlative");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenant_id_rut_key" ON "users"("tenant_id", "rut");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_code_key" ON "tenants"("code");

-- CreateIndex
CREATE UNIQUE INDEX "contracts_tenant_id_code_key" ON "contracts"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "subcontracts_contract_id_code_key" ON "subcontracts"("contract_id", "code");

-- AddForeignKey
ALTER TABLE "equipments" ADD CONSTRAINT "equipments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipments" ADD CONSTRAINT "equipments_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipments" ADD CONSTRAINT "equipments_subcontract_id_fkey" FOREIGN KEY ("subcontract_id") REFERENCES "subcontracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_items" ADD CONSTRAINT "catalog_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_subcontract_id_fkey" FOREIGN KEY ("subcontract_id") REFERENCES "subcontracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_equipment_id_fkey" FOREIGN KEY ("equipment_id") REFERENCES "equipments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_systems" ADD CONSTRAINT "work_order_systems_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_systems" ADD CONSTRAINT "work_order_systems_catalog_item_id_fkey" FOREIGN KEY ("catalog_item_id") REFERENCES "catalog_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_fluids" ADD CONSTRAINT "work_order_fluids_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_fluids" ADD CONSTRAINT "work_order_fluids_catalog_item_id_fkey" FOREIGN KEY ("catalog_item_id") REFERENCES "catalog_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcontracts" ADD CONSTRAINT "subcontracts_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_contracts" ADD CONSTRAINT "user_contracts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_contracts" ADD CONSTRAINT "user_contracts_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_tasks" ADD CONSTRAINT "work_order_tasks_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_parts" ADD CONSTRAINT "work_order_parts_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
