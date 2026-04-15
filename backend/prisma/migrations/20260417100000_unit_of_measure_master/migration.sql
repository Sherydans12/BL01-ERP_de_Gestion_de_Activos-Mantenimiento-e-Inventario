-- Maestro de unidades de medida por tenant y FK en inventory_items.

CREATE TABLE "unit_of_measures" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "abbreviation" VARCHAR(20) NOT NULL,

    CONSTRAINT "unit_of_measures_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "unit_of_measures_tenant_id_abbreviation_key" ON "unit_of_measures"("tenant_id", "abbreviation");

CREATE INDEX "unit_of_measures_tenant_id_idx" ON "unit_of_measures"("tenant_id");

ALTER TABLE "unit_of_measures" ADD CONSTRAINT "unit_of_measures_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "unit_of_measures" ("id", "tenant_id", "name", "abbreviation")
SELECT gen_random_uuid(), t."id", v.name, v.abbr
FROM "tenants" t
CROSS JOIN (
  VALUES
    ('Unidades', 'UN'),
    ('Kilogramos', 'KG'),
    ('Litros', 'LT'),
    ('Metros', 'MT')
) AS v(name, abbr);

ALTER TABLE "inventory_items" ADD COLUMN "unit_of_measure_id" UUID;

UPDATE "inventory_items" ii
SET "unit_of_measure_id" = u."id"
FROM "unit_of_measures" u
WHERE u."tenant_id" = ii."tenant_id"
  AND u."abbreviation" = 'UN';

UPDATE "inventory_items" ii
SET "unit_of_measure_id" = u."id"
FROM "unit_of_measures" u
WHERE u."tenant_id" = ii."tenant_id"
  AND ii."unit_of_measure_id" IS NULL
  AND upper(trim(ii."unit_of_measure")) = u."abbreviation";

UPDATE "inventory_items" ii
SET "unit_of_measure_id" = u."id"
FROM "unit_of_measures" u
WHERE u."tenant_id" = ii."tenant_id"
  AND u."abbreviation" = 'LT'
  AND ii."unit_of_measure_id" IS NULL
  AND upper(trim(ii."unit_of_measure")) IN ('L', 'LT', 'LTR', 'LITRO', 'LITROS');

UPDATE "inventory_items" ii
SET "unit_of_measure_id" = u."id"
FROM "unit_of_measures" u
WHERE u."tenant_id" = ii."tenant_id"
  AND u."abbreviation" = 'MT'
  AND ii."unit_of_measure_id" IS NULL
  AND upper(trim(ii."unit_of_measure")) IN ('M', 'MT', 'MTR', 'METRO', 'METROS');

UPDATE "inventory_items" ii
SET "unit_of_measure_id" = u."id"
FROM "unit_of_measures" u
WHERE u."tenant_id" = ii."tenant_id"
  AND u."abbreviation" = 'KG'
  AND ii."unit_of_measure_id" IS NULL
  AND upper(trim(ii."unit_of_measure")) IN ('KG', 'KILO', 'KILOGRAMO', 'KILOGRAMOS');

UPDATE "inventory_items" ii
SET "unit_of_measure_id" = (
  SELECT u2."id" FROM "unit_of_measures" u2
  WHERE u2."tenant_id" = ii."tenant_id" AND u2."abbreviation" = 'UN'
  LIMIT 1
)
WHERE ii."unit_of_measure_id" IS NULL;

ALTER TABLE "inventory_items" DROP COLUMN "unit_of_measure";

ALTER TABLE "inventory_items" ALTER COLUMN "unit_of_measure_id" SET NOT NULL;

ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_unit_of_measure_id_fkey" FOREIGN KEY ("unit_of_measure_id") REFERENCES "unit_of_measures"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
