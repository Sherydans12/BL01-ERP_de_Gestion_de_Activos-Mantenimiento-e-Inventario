-- Bloqueo opcional de stock negativo por tenant (inventario / despachos de terreno).
ALTER TABLE "tenant_operational_configs"
ADD COLUMN "block_negative_stock" BOOLEAN NOT NULL DEFAULT false;
