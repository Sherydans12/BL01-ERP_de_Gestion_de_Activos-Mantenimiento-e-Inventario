-- AlterTable
ALTER TABLE "tenant_roles" ADD COLUMN "permissions" JSONB NOT NULL DEFAULT '[]';
