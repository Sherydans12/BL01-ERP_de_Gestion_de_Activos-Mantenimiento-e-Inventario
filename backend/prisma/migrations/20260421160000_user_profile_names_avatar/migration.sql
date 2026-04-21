-- Perfil: nombre/apellido separados y avatar (URL pública bajo /uploads/...).
ALTER TABLE "users" ADD COLUMN "first_name" VARCHAR(100);
ALTER TABLE "users" ADD COLUMN "last_name" VARCHAR(100);
ALTER TABLE "users" ADD COLUMN "avatar_url" VARCHAR(500);

-- Backfill conservador desde `name` (primera palabra = nombre, resto = apellido).
UPDATE "users"
SET
  "first_name" = NULLIF(trim(split_part(trim("name"), ' ', 1)), ''),
  "last_name" = NULLIF(
    trim(
      substring(trim("name") from length(split_part(trim("name"), ' ', 1)) + 2)
    ),
    ''
  )
WHERE "first_name" IS NULL AND "last_name" IS NULL AND trim("name") <> '';
