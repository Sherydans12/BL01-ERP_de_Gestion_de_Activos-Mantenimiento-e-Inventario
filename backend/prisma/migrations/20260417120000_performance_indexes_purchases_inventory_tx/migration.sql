-- Embudos analíticos y kardex: filtros por tenant/status/fecha sin full scan.
CREATE INDEX IF NOT EXISTS "purchase_requisitions_tenant_id_status_idx" ON "purchase_requisitions" ("tenant_id", "status");
CREATE INDEX IF NOT EXISTS "purchase_requisitions_tenant_id_created_at_idx" ON "purchase_requisitions" ("tenant_id", "created_at");

CREATE INDEX IF NOT EXISTS "purchase_orders_tenant_id_status_idx" ON "purchase_orders" ("tenant_id", "status");
CREATE INDEX IF NOT EXISTS "purchase_orders_tenant_id_created_at_idx" ON "purchase_orders" ("tenant_id", "created_at");

CREATE INDEX IF NOT EXISTS "inventory_transactions_warehouse_id_date_idx" ON "inventory_transactions" ("warehouse_id", "date");
CREATE INDEX IF NOT EXISTS "inventory_transactions_date_idx" ON "inventory_transactions" ("date");
CREATE INDEX IF NOT EXISTS "inventory_transactions_type_date_idx" ON "inventory_transactions" ("type", "date");
