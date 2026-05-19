-- Migration: receipt_item_quantity_confirmed
-- Agrega quantity_confirmed a receipt_items para trackear qué cantidad ya fue
-- confirmada (movida a stock) en una guía que puede confirmarse en varias pasadas.
-- Las guías ya confirmadas (PARTIAL o COMPLETED) se backfillean con quantity_received
-- para que no generen delta doble al ser re-confirmadas.

ALTER TABLE "receipt_items"
  ADD COLUMN "quantity_confirmed" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- Backfill: recepciones ya confirmadas (PARTIAL / COMPLETED) → quantityConfirmed = quantityReceived
UPDATE "receipt_items" ri
SET    "quantity_confirmed" = ri."quantity_received"
FROM   "warehouse_receipts" wr
WHERE  ri."receipt_id" = wr."id"
  AND  wr."status" IN ('PARTIAL', 'COMPLETED');
