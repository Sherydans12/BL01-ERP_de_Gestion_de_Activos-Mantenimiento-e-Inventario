-- CreateTable: tenant_operational_configs
-- Lazy-created per tenant: if no row exists, application defaults apply (hasNightShift=true, 08:00/20:00).
CREATE TABLE "tenant_operational_configs" (
    "id"                    TEXT NOT NULL,
    "tenant_id"             UUID NOT NULL,
    "has_night_shift"       BOOLEAN NOT NULL DEFAULT true,
    "day_shift_start_time"  VARCHAR(5) NOT NULL DEFAULT '08:00',
    "night_shift_start_time" VARCHAR(5) NOT NULL DEFAULT '20:00',
    "created_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"            TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_operational_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (unique 1:1 with tenants)
CREATE UNIQUE INDEX "tenant_operational_configs_tenant_id_key" ON "tenant_operational_configs"("tenant_id");

-- AddForeignKey
ALTER TABLE "tenant_operational_configs"
    ADD CONSTRAINT "tenant_operational_configs_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
