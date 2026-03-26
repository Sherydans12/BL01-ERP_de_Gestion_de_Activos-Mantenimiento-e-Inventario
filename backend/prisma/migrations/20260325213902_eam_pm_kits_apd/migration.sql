-- CreateEnum
CREATE TYPE "TaskAction" AS ENUM ('INSPECT', 'REPLACE', 'ADJUST', 'CLEAN', 'LUBRICATE');

-- CreateEnum
CREATE TYPE "SampleStatus" AS ENUM ('PENDING', 'SENT_TO_LAB', 'ANALYZED');

-- AlterTable
ALTER TABLE "work_order_tasks" ADD COLUMN     "action" "TaskAction" DEFAULT 'INSPECT',
ADD COLUMN     "estimated_hours" DOUBLE PRECISION,
ADD COLUMN     "tracking_code" VARCHAR(50);

-- CreateTable
CREATE TABLE "fluid_samples" (
    "id" UUID NOT NULL,
    "work_order_id" UUID NOT NULL,
    "system_id" UUID NOT NULL,
    "bottle_code" VARCHAR(50) NOT NULL,
    "status" "SampleStatus" NOT NULL DEFAULT 'PENDING',
    "results" TEXT,

    CONSTRAINT "fluid_samples_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_kits" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" TEXT,

    CONSTRAINT "maintenance_kits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_kit_parts" (
    "id" UUID NOT NULL,
    "kit_id" UUID NOT NULL,
    "part_number" VARCHAR(50) NOT NULL,
    "description" VARCHAR(100) NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,

    CONSTRAINT "maintenance_kit_parts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "maintenance_kits_tenant_id_code_key" ON "maintenance_kits"("tenant_id", "code");

-- AddForeignKey
ALTER TABLE "fluid_samples" ADD CONSTRAINT "fluid_samples_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "work_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fluid_samples" ADD CONSTRAINT "fluid_samples_system_id_fkey" FOREIGN KEY ("system_id") REFERENCES "catalog_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_kit_parts" ADD CONSTRAINT "maintenance_kit_parts_kit_id_fkey" FOREIGN KEY ("kit_id") REFERENCES "maintenance_kits"("id") ON DELETE CASCADE ON UPDATE CASCADE;
