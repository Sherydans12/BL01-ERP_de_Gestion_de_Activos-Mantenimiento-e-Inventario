-- Migrar datos legacy antes de reducir el enum UserRole
UPDATE "users" SET "role" = 'USER' WHERE "role" IN ('MECHANIC', 'SUPERVISOR');
UPDATE "tenant_roles" SET "base_role" = 'USER' WHERE "base_role" IN ('MECHANIC', 'SUPERVISOR');

-- AlterEnum (Prisma): reemplazar UserRole sin MECHANIC ni SUPERVISOR
ALTER TYPE "UserRole" RENAME TO "UserRole_old";
CREATE TYPE "UserRole" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'USER');

ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "users" ALTER COLUMN "role" TYPE "UserRole" USING ("role"::text::"UserRole");
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'USER';

ALTER TABLE "tenant_roles" ALTER COLUMN "base_role" DROP DEFAULT;
ALTER TABLE "tenant_roles" ALTER COLUMN "base_role" TYPE "UserRole" USING ("base_role"::text::"UserRole");
ALTER TABLE "tenant_roles" ALTER COLUMN "base_role" SET DEFAULT 'USER';

DROP TYPE "UserRole_old";
