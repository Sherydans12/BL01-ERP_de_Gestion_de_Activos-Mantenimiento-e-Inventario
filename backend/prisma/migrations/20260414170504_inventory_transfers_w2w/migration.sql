-- Idempotente: BD nueva o reintento tras fallo parcial (P3018 / rolled-back).

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "InventoryTransferStatus" AS ENUM ('COMPLETED', 'CANCELLED');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AlterEnum (PostgreSQL 16: IF NOT EXISTS)
ALTER TYPE "TransactionType" ADD VALUE IF NOT EXISTS 'TRANSFER_OUT';
ALTER TYPE "TransactionType" ADD VALUE IF NOT EXISTS 'TRANSFER_IN';

-- DropIndex
DROP INDEX IF EXISTS "idx_inventory_items_name_trgm";
DROP INDEX IF EXISTS "idx_inventory_items_part_number_trgm";
DROP INDEX IF EXISTS "idx_inventory_items_tenant_category";
DROP INDEX IF EXISTS "item_categories_tenant_id_name_key";

-- AlterTable
ALTER TABLE "item_categories" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "unit_of_measures" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "warehouse_bins" ALTER COLUMN "id" DROP DEFAULT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "inventory_transfers" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "origin_warehouse_id" UUID NOT NULL,
    "destination_warehouse_id" UUID NOT NULL,
    "status" "InventoryTransferStatus" NOT NULL DEFAULT 'COMPLETED',
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_transfers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "inventory_transfer_lines" (
    "id" UUID NOT NULL,
    "transfer_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unit_cost" DECIMAL(18,4) NOT NULL,

    CONSTRAINT "inventory_transfer_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "inventory_transfers_tenant_id_created_at_idx" ON "inventory_transfers"("tenant_id", "created_at");
CREATE INDEX IF NOT EXISTS "inventory_transfer_lines_transfer_id_idx" ON "inventory_transfer_lines"("transfer_id");
CREATE INDEX IF NOT EXISTS "item_categories_tenant_id_idx" ON "item_categories"("tenant_id");
CREATE INDEX IF NOT EXISTS "item_categories_tenant_id_parent_category_id_idx" ON "item_categories"("tenant_id", "parent_category_id");

-- AddForeignKey
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_transfers_tenant_id_fkey') THEN
        ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_transfers_origin_warehouse_id_fkey') THEN
        ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_origin_warehouse_id_fkey" FOREIGN KEY ("origin_warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_transfers_destination_warehouse_id_fkey') THEN
        ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_destination_warehouse_id_fkey" FOREIGN KEY ("destination_warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_transfers_created_by_id_fkey') THEN
        ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_transfer_lines_transfer_id_fkey') THEN
        ALTER TABLE "inventory_transfer_lines" ADD CONSTRAINT "inventory_transfer_lines_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "inventory_transfers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_transfer_lines_item_id_fkey') THEN
        ALTER TABLE "inventory_transfer_lines" ADD CONSTRAINT "inventory_transfer_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;
