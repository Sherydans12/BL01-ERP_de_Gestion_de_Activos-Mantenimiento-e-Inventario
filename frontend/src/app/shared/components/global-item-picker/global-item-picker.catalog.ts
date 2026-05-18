/**
 * Configuración compartida del selector global de artículos
 * (`app-global-item-picker`). Se usa en, entre otras:
 * requerimiento de compra, control de stock / movimientos, detalle OC,
 * formulario OT. La pantalla **W2W dedicada** (`inventory-transfer`) también
 * monta el picker pero con **`allowQuickAdd: false`** en plantilla (no usa
 * esta constante tal cual). El título puede sobrescribirse por pantalla.
 */
export const GLOBAL_ITEM_PICKER_CATALOG = {
  strictFamilyFirst: true,
  allowQuickAdd: true,
  onlyWithStockInWarehouse: false,
  titleMaster: 'Catálogo Maestro de Artículos',
} as const;
