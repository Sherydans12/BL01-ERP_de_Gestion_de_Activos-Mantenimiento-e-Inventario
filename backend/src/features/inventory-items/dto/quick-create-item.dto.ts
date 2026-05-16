/**
 * Cuerpo POST /inventory-items/quick-create (modal selector / compras).
 * SKU siempre autogenerado (IN####); no enviar `inventoryCode` (no vacío → 400).
 */
export interface QuickCreateItemDto {
  name: string;
  /** Subcategoría (nivel 2). */
  categoryId: string;
  unitOfMeasureId: string;
  warehouseId?: string;
  minStock?: number;
  maxStock?: number;
  /** @deprecated El backend lo ignora/rechaza; el SKU lo asigna el sistema. */
  inventoryCode?: string;
  /** Nº de parte; si se omite o vacío, queda null (sin autogeneración). */
  partNumber?: string;
  description?: string;
  brand?: string;
  compatibilityInfo?: string;
  isSerialized?: boolean;
  isInventory?: boolean;
  isAsset?: boolean;
  isConsumable?: boolean;
}
