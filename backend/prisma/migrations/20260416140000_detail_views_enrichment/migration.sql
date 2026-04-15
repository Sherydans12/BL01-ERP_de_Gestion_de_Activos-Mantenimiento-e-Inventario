-- Enums y columnas para vistas de detalle (REQ prioridad, OC logística, factura neto/IVA).

CREATE TYPE "RequisitionPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

ALTER TABLE "purchase_requisitions" ADD COLUMN "priority" "RequisitionPriority" NOT NULL DEFAULT 'MEDIUM';

ALTER TABLE "purchase_orders" ADD COLUMN "delivery_address" VARCHAR(500),
ADD COLUMN "payment_terms" VARCHAR(120);

ALTER TABLE "purchase_invoices" ADD COLUMN "net_amount" DECIMAL(18,2),
ADD COLUMN "tax_amount" DECIMAL(18,2);
