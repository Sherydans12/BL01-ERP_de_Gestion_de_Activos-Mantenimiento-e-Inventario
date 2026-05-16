/**
 * Configuración compartida del selector global de artículos
 * (`app-global-item-picker`) en requerimientos, control de stock, OC, etc.
 * El título puede sobrescribirse por pantalla; el resto evita desalineación UX.
 */
export const GLOBAL_ITEM_PICKER_CATALOG = {
  strictFamilyFirst: true,
  allowQuickAdd: true,
  onlyWithStockInWarehouse: false,
  titleMaster: 'Catálogo Maestro de Artículos',
} as const;
