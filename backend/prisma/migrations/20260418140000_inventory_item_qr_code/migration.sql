-- Código QR estable por artículo (payload escaneable).
ALTER TABLE "inventory_items" ADD COLUMN "qr_code" VARCHAR(120);

UPDATE "inventory_items"
SET "qr_code" = 'INV:' || "id"::text
WHERE "qr_code" IS NULL;

ALTER TABLE "inventory_items" ALTER COLUMN "qr_code" SET NOT NULL;

CREATE UNIQUE INDEX "inventory_items_tenant_id_qr_code_key" ON "inventory_items"("tenant_id", "qr_code");

CREATE INDEX "inventory_items_tenant_id_qr_code_idx" ON "inventory_items"("tenant_id", "qr_code");
