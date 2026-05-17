-- Fase 1: Transición 1:1 → 1:N (multi-factura por OC)
-- Elimina el índice UNIQUE en purchase_invoices.purchase_order_id para permitir
-- múltiples facturas por Orden de Compra.
-- Agrega índice compuesto (tenant_id, purchase_order_id) para optimizar consultas agregadas 3-way match.

-- DropIndex (unique constraint generado por @unique en Prisma)
DROP INDEX IF EXISTS "purchase_invoices_purchase_order_id_key";

-- CreateIndex (compuesto para agregación multi-factura)
CREATE INDEX IF NOT EXISTS "purchase_invoices_tenant_id_purchase_order_id_idx"
  ON "purchase_invoices"("tenant_id", "purchase_order_id");
