-- Búsqueda ILIKE eficiente con miles de filas (pg_trgm).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_inventory_items_name_trgm
  ON inventory_items USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_inventory_items_part_number_trgm
  ON inventory_items USING gin (part_number gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_inventory_items_tenant_category
  ON inventory_items (tenant_id, category_id);
