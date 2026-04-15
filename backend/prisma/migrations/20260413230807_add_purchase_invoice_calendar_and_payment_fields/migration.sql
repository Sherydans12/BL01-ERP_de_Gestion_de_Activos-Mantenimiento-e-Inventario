-- AlterTable
ALTER TABLE "purchase_invoices" ADD COLUMN     "due_date" TIMESTAMP(3),
ADD COLUMN     "paid_at" TIMESTAMP(3),
ADD COLUMN     "payment_reference" VARCHAR(120);

-- CreateIndex
CREATE INDEX "purchase_invoices_tenant_id_due_date_idx" ON "purchase_invoices"("tenant_id", "due_date");
