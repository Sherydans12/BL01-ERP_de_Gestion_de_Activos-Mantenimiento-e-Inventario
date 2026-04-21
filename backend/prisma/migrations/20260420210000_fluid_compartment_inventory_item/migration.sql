ALTER TABLE "work_order_fluid_compartments"
ADD COLUMN IF NOT EXISTS "inventory_item_id" UUID;

CREATE INDEX IF NOT EXISTS "work_order_fluid_compartments_inventory_item_id_idx"
ON "work_order_fluid_compartments" ("inventory_item_id");

ALTER TABLE "work_order_fluid_compartments"
ADD CONSTRAINT "work_order_fluid_compartments_inventory_item_id_fkey"
FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
