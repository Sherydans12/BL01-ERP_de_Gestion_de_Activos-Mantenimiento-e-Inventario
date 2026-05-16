-- Política de umbrales por bodega objetivo: se aplica al crear la primera fila item_stocks (sin posición con cantidad 0 antes).
ALTER TABLE "inventory_items" ADD COLUMN "policy_target_warehouse_id" UUID;
ALTER TABLE "inventory_items" ADD COLUMN "policy_min_stock" DOUBLE PRECISION;
ALTER TABLE "inventory_items" ADD COLUMN "policy_max_stock" DOUBLE PRECISION;

ALTER TABLE "inventory_items"
  ADD CONSTRAINT "inventory_items_policy_target_warehouse_id_fkey"
  FOREIGN KEY ("policy_target_warehouse_id") REFERENCES "warehouses"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "inventory_items_policy_target_warehouse_id_idx"
  ON "inventory_items" ("policy_target_warehouse_id");
