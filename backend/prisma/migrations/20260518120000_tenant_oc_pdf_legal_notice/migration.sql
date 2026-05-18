-- Aviso legal configurable en el PDF de OC (tenant-config / empresa)
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "oc_pdf_legal_notice" TEXT;
