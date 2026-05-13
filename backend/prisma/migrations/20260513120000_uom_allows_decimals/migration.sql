-- AlterTable: agrega allows_decimals a unit_of_measures
ALTER TABLE "unit_of_measures" ADD COLUMN IF NOT EXISTS "allows_decimals" BOOLEAN NOT NULL DEFAULT false;

-- Unidades que sí permiten fracciones: KG, LT, LTS, MT
UPDATE "unit_of_measures" SET "allows_decimals" = true WHERE "abbreviation" IN ('KG', 'LT', 'LTS', 'MT');
