-- CreateEnum
CREATE TYPE "ActivityAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'STATUS_CHANGE', 'SIGNATURE');

-- CreateTable
CREATE TABLE "activity_logs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "action" "ActivityAction" NOT NULL,
    "entity_type" VARCHAR(40) NOT NULL,
    "entity_id" VARCHAR(36) NOT NULL,
    "details" JSONB NOT NULL,
    "ip_address" VARCHAR(64),
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "activity_logs_tenant_id_entity_type_entity_id_idx" ON "activity_logs"("tenant_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "activity_logs_tenant_id_created_at_idx" ON "activity_logs"("tenant_id", "created_at");

-- AddForeignKey
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
