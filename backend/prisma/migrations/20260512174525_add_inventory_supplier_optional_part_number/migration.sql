-- Proveedor habitual de artículo de inventario (independiente del módulo de compras)
CREATE TABLE "inventory_suppliers" (
    "id"         UUID         NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id"  UUID         NOT NULL,
    "name"       VARCHAR(150) NOT NULL,
    CONSTRAINT "inventory_suppliers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "inventory_suppliers_tenant_id_name_key"
    ON "inventory_suppliers"("tenant_id", "name");

CREATE INDEX "inventory_suppliers_tenant_id_idx"
    ON "inventory_suppliers"("tenant_id");

ALTER TABLE "inventory_suppliers"
    ADD CONSTRAINT "inventory_suppliers_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- partNumber pasa a ser nullable (no todos los artículos tienen número de parte)
ALTER TABLE "inventory_items"
    ALTER COLUMN "part_number" DROP NOT NULL;

-- supplierId opcional en inventory_items
ALTER TABLE "inventory_items"
    ADD COLUMN "supplier_id" UUID;

ALTER TABLE "inventory_items"
    ADD CONSTRAINT "inventory_items_supplier_id_fkey"
    FOREIGN KEY ("supplier_id") REFERENCES "inventory_suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
