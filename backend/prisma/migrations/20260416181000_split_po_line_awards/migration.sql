-- Split PO: adjudicación por ítem, trazabilidad REQ 1:N OC, idempotencia por línea de cotización.

-- pg_enum.enumtypid debe resolverse vía pg_type: el cast 'RequisitionStatus'::regtype
-- se interpreta como tipo minúsculo inexistente en PG.
DO $M$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = current_schema()
      AND t.typname = 'RequisitionStatus'
      AND e.enumlabel = 'PARTIALLY_PURCHASED'
  ) THEN
    ALTER TYPE "RequisitionStatus" ADD VALUE 'PARTIALLY_PURCHASED' AFTER 'PENDING_APPROVAL';
  END IF;
END
$M$;

DROP INDEX IF EXISTS "purchase_orders_quotation_id_key";

ALTER TABLE "purchase_orders" ADD COLUMN "requisition_id" UUID;

UPDATE "purchase_orders" po
SET "requisition_id" = pq."requisition_id"
FROM "purchase_quotations" pq
WHERE po."quotation_id" = pq."id"
  AND po."requisition_id" IS NULL;

ALTER TABLE "purchase_orders"
  ADD CONSTRAINT "purchase_orders_requisition_id_fkey"
  FOREIGN KEY ("requisition_id") REFERENCES "purchase_requisitions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "purchase_orders_tenant_id_requisition_id_idx"
  ON "purchase_orders" ("tenant_id", "requisition_id");

ALTER TABLE "requisition_items" ADD COLUMN "awarded_quotation_item_id" UUID;

ALTER TABLE "requisition_items"
  ADD CONSTRAINT "requisition_items_awarded_quotation_item_id_fkey"
  FOREIGN KEY ("awarded_quotation_item_id") REFERENCES "quotation_items"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "purchase_order_items" ADD COLUMN "source_quotation_item_id" UUID;

ALTER TABLE "purchase_order_items"
  ADD CONSTRAINT "purchase_order_items_source_quotation_item_id_fkey"
  FOREIGN KEY ("source_quotation_item_id") REFERENCES "quotation_items"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "purchase_order_items_source_quotation_item_id_idx"
  ON "purchase_order_items" ("source_quotation_item_id");
