-- Ciudad y razón social fiscal para OC / facturación (configuración empresa)
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "city" VARCHAR(120);
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "invoice_legal_name" VARCHAR(200);
