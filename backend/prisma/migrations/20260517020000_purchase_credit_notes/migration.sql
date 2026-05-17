-- Fase 3: Modelo de Notas de Crédito de Proveedor.
-- Crea la tabla purchase_credit_notes vinculada a OC y opcionalmente a factura.

CREATE TABLE "purchase_credit_notes" (
  "id"                   UUID          NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"            UUID          NOT NULL,
  "purchase_order_id"    UUID          NOT NULL,
  "purchase_invoice_id"  UUID,
  "credit_note_number"   VARCHAR(80)   NOT NULL,
  "emission_date"        TIMESTAMP(3)  NOT NULL,
  "total_amount"         DECIMAL(18,2) NOT NULL,
  "notes"                TEXT,
  "created_at"           TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"           TIMESTAMP(3)  NOT NULL,

  CONSTRAINT "purchase_credit_notes_pkey" PRIMARY KEY ("id")
);

-- Constraints de integridad referencial
ALTER TABLE "purchase_credit_notes"
  ADD CONSTRAINT "purchase_credit_notes_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "purchase_credit_notes"
  ADD CONSTRAINT "purchase_credit_notes_purchase_order_id_fkey"
    FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "purchase_credit_notes"
  ADD CONSTRAINT "purchase_credit_notes_purchase_invoice_id_fkey"
    FOREIGN KEY ("purchase_invoice_id") REFERENCES "purchase_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Índices
CREATE UNIQUE INDEX "purchase_credit_notes_tenant_id_credit_note_number_purchase_order_id_key"
  ON "purchase_credit_notes"("tenant_id", "credit_note_number", "purchase_order_id");

CREATE INDEX "purchase_credit_notes_tenant_id_purchase_order_id_idx"
  ON "purchase_credit_notes"("tenant_id", "purchase_order_id");
