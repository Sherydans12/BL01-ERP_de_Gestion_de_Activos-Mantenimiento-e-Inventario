-- Logo dedicado a PDFs de compras (separado del logo del menú lateral).
ALTER TABLE "tenants" ADD COLUMN "pdf_logo_url" VARCHAR(255);

-- Paridad con el comportamiento anterior: mismo archivo en menú y PDF hasta que suban un logo PDF distinto.
UPDATE "tenants" SET "pdf_logo_url" = "logo_url" WHERE "pdf_logo_url" IS NULL AND "logo_url" IS NOT NULL;