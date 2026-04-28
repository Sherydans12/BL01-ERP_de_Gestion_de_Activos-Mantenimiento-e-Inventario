/**
 * Cuerpo POST /inventory-items/quick-create (modal selector / compras).
 * Alineado con campos clave de CreateInventoryItemDto; códigos vacíos → correlativo.
 */
export interface QuickCreateItemDto {
  name: string;
  /** Subcategoría (nivel 2). */
  categoryId: string;
  unitOfMeasureId: string;
  warehouseId?: string;
  minStock?: number;
  maxStock?: number;
  /** SKU interno; si se omite o vacío, correlativo INV-xxxxx. */
  inventoryCode?: string;
  /** Nº de parte; si se omite o vacío, correlativo AUTO-xxxxx. */
  partNumber?: string;
  description?: string;
  brand?: string;
  compatibilityInfo?: string;
  isSerialized?: boolean;
  isInventory?: boolean;
  isAsset?: boolean;
  isConsumable?: boolean;
}
