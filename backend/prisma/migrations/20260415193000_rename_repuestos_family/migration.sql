-- Unificación de naming: la familia raíz ya no se llama "Repuestos".
UPDATE item_categories
SET name = 'Materiales generales'
WHERE parent_category_id IS NULL
  AND name = 'Repuestos';
