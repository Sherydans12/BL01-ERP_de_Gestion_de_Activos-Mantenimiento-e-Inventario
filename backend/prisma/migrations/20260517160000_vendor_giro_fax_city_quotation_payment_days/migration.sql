-- Datos extendidos proveedor + plazo de pago en cotización (OC / PDF)
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "business_activity" VARCHAR(255);
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "fax" VARCHAR(30);
ALTER TABLE "vendors" ADD COLUMN IF NOT EXISTS "city" VARCHAR(120);

ALTER TABLE "purchase_quotations" ADD COLUMN IF NOT EXISTS "payment_days" INTEGER;
