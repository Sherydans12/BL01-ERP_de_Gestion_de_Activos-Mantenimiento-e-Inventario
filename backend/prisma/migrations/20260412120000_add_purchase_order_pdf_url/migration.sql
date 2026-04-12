-- AlterTable (IF NOT EXISTS: seguro si la columna ya fue creada manualmente)
ALTER TABLE "purchase_orders" ADD COLUMN IF NOT EXISTS "pdf_url" TEXT;
