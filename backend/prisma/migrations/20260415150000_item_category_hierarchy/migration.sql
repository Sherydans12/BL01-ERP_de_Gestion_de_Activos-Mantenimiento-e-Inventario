-- Jerarquía Familia / Subcategoría + eliminación de categoría texto libre en ítems

-- 1) Columnas nuevas en item_categories
ALTER TABLE "item_categories"
    ADD COLUMN IF NOT EXISTS "parent_category_id" UUID,
    ADD COLUMN IF NOT EXISTS "is_global" BOOLEAN NOT NULL DEFAULT false;

-- 2) FK auto-referencia (antes de datos)
ALTER TABLE "item_categories"
    DROP CONSTRAINT IF EXISTS "item_categories_parent_category_id_fkey";

ALTER TABLE "item_categories"
    ADD CONSTRAINT "item_categories_parent_category_id_fkey"
    FOREIGN KEY ("parent_category_id") REFERENCES "item_categories"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- 3) Quitar unicidad antigua (tenant_id, name)
ALTER TABLE "item_categories" DROP CONSTRAINT IF EXISTS "item_categories_tenant_id_name_key";

-- 4) Familia "Repuestos" por tenant (raíz)
INSERT INTO "item_categories" ("id", "tenant_id", "name", "parent_category_id", "is_global")
SELECT gen_random_uuid(), t."id", 'Repuestos', NULL, true
FROM "tenants" t
WHERE NOT EXISTS (
    SELECT 1 FROM "item_categories" ic
    WHERE ic."tenant_id" = t."id"
      AND ic."name" = 'Repuestos'
      AND ic."parent_category_id" IS NULL
);

-- 5) Categorías existentes (raíz) → subcategorías bajo "Repuestos" (la fila familia no se toca)
UPDATE "item_categories" ic
SET
    "parent_category_id" = fam."id",
    "is_global" = false
FROM "item_categories" fam
WHERE fam."tenant_id" = ic."tenant_id"
  AND fam."name" = 'Repuestos'
  AND fam."parent_category_id" IS NULL
  AND ic."parent_category_id" IS NULL
  AND ic."id" <> fam."id";

UPDATE "item_categories"
SET "is_global" = true
WHERE "name" = 'Repuestos' AND "parent_category_id" IS NULL;

-- 6) Subcategoría "General" bajo Repuestos (para artículos sin categoría previa)
INSERT INTO "item_categories" ("id", "tenant_id", "name", "parent_category_id", "is_global")
SELECT gen_random_uuid(), fam."tenant_id", 'General', fam."id", false
FROM "item_categories" fam
WHERE fam."name" = 'Repuestos'
  AND fam."parent_category_id" IS NULL
  AND NOT EXISTS (
      SELECT 1 FROM "item_categories" icg
      WHERE icg."parent_category_id" = fam."id"
        AND icg."name" = 'General'
  );

-- 7) Asignar category_id a ítems huérfanos → General
UPDATE "inventory_items" ii
SET "category_id" = icg."id"
FROM "item_categories" icg
INNER JOIN "item_categories" fam ON icg."parent_category_id" = fam."id"
WHERE ii."category_id" IS NULL
  AND ii."tenant_id" = icg."tenant_id"
  AND fam."name" = 'Repuestos'
  AND fam."parent_category_id" IS NULL
  AND icg."name" = 'General';

-- 8) Cualquier ítem aún sin categoría (por seguridad): primera subcategoría del tenant
UPDATE "inventory_items" ii
SET "category_id" = (
    SELECT ic."id"
    FROM "item_categories" ic
    WHERE ic."tenant_id" = ii."tenant_id"
      AND ic."parent_category_id" IS NOT NULL
    ORDER BY ic."name"
    LIMIT 1
)
WHERE ii."category_id" IS NULL;

-- 9) Eliminar columna de texto libre
ALTER TABLE "inventory_items" DROP COLUMN IF EXISTS "category";

-- 10) category_id obligatorio y FK restrict (ítem siempre ligado a subcategoría)
ALTER TABLE "inventory_items" ALTER COLUMN "category_id" SET NOT NULL;

ALTER TABLE "inventory_items" DROP CONSTRAINT IF EXISTS "inventory_items_category_id_fkey";

ALTER TABLE "inventory_items"
    ADD CONSTRAINT "inventory_items_category_id_fkey"
    FOREIGN KEY ("category_id") REFERENCES "item_categories"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- 11) Índices únicos parciales (raíz vs hijo)
CREATE UNIQUE INDEX IF NOT EXISTS "item_categories_tenant_root_name_key"
    ON "item_categories" ("tenant_id", "name")
    WHERE "parent_category_id" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "item_categories_tenant_parent_name_key"
    ON "item_categories" ("tenant_id", "parent_category_id", "name")
    WHERE "parent_category_id" IS NOT NULL;
