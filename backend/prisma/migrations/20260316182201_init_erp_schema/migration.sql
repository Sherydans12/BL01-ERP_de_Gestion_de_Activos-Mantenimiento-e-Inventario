-- CreateEnum
CREATE TYPE "CatalogCategory" AS ENUM ('EQUIPMENT_TYPE', 'BRAND', 'SYSTEM', 'FLUID');

-- CreateEnum
CREATE TYPE "OtType" AS ENUM ('NUEVA', 'CONTINUIDAD');

-- CreateEnum
CREATE TYPE "OtCategory" AS ENUM ('PROGRAMADA', 'NO_PROGRAMADA', 'ACCIDENTE');

-- CreateEnum
CREATE TYPE "OtStatus" AS ENUM ('ABIERTA', 'EN_REVISION', 'CERRADA');

-- CreateEnum
CREATE TYPE "FluidAction" AS ENUM ('RELLENO', 'CAMBIO');

-- CreateTable
CREATE TABLE "equipments" (
    "id" UUID NOT NULL,
    "internal_id" VARCHAR(50) NOT NULL,
    "plate" VARCHAR(20),
    "type" VARCHAR(50) NOT NULL,
    "brand" VARCHAR(50) NOT NULL,
    "model" VARCHAR(50) NOT NULL,
    "current_horometer" INTEGER NOT NULL DEFAULT 0,
    "tech_review_exp" DATE,
    "circ_permit_exp" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "equipments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_items" (
    "id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "category" "CatalogCategory" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "catalog_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_orders" (
    "id" UUID NOT NULL,
    "correlative" VARCHAR(30) NOT NULL,
    "equipment_id" UUID NOT NULL,
    "type" "OtType" NOT NULL DEFAULT 'NUEVA',
    "category" "OtCategory" NOT NULL,
    "status" "OtStatus" NOT NULL DEFAULT 'ABIERTA',
    "initial_horometer" INTEGER NOT NULL,
    "final_horometer" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "has_backlog" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "synced_at" TIMESTAMP(3),

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

-- CreateIndex
CREATE UNIQUE INDEX "equipments_internal_id_key" ON "equipments"("internal_id");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_items_code_key" ON "catalog_items"("code");

-- CreateIndex
CREATE UNIQUE INDEX "work_orders_correlative_key" ON "work_orders"("correlative");

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
