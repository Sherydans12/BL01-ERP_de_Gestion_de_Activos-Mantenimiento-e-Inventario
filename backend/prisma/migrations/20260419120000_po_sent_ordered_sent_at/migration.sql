-- Estados formales de despacho a proveedor (SENT / ORDERED) y auditoría de lead time.
ALTER TYPE "PurchaseOrderStatus" ADD VALUE 'SENT';
ALTER TYPE "PurchaseOrderStatus" ADD VALUE 'ORDERED';

ALTER TABLE "purchase_orders" ADD COLUMN "sent_at" TIMESTAMP(3);

-- Normaliza el valor legado al estado SENT solicitado por el proceso.
UPDATE "purchase_orders"
SET "status" = 'SENT'::"PurchaseOrderStatus"
WHERE "status" = 'SENT_TO_SUPPLIER'::"PurchaseOrderStatus";

-- Lead time: para filas ya enviadas, aproximamos sent_at con la última actualización administrativa.
UPDATE "purchase_orders"
SET "sent_at" = COALESCE("sent_at", "updated_at")
WHERE "status" = 'SENT'::"PurchaseOrderStatus"
  AND "sent_at" IS NULL;
