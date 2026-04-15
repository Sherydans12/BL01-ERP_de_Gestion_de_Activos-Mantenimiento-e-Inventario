-- Descripción opcional para familias y subcategorías (configuración por tenant).
ALTER TABLE "item_categories" ADD COLUMN IF NOT EXISTS "description" TEXT;
