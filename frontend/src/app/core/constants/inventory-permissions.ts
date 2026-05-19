/**
 * Llaves PBAC de Inventario (alineadas con backend SystemPermissions y RBAC-PERMISSIONS-CATALOG.md).
 */
export const I = {
  ITEM_READ: 'inventory:item:read',
  ITEM_CREATE: 'inventory:item:create',
  ITEM_UPDATE: 'inventory:item:update',
  ITEM_DELETE: 'inventory:item:delete',

  WAREHOUSE_READ: 'inventory:warehouse:read',
  WAREHOUSE_MANAGE: 'inventory:warehouse:manage',

  CATEGORY_READ: 'inventory:category:read',
  CATEGORY_MANAGE: 'inventory:category:manage',

  TRANSFER_READ: 'inventory:transfer:read',
  TRANSFER_CREATE: 'inventory:transfer:create',
  TRANSFER_APPROVE: 'inventory:transfer:approve',

  STOCK_READ: 'inventory:stock:read',
  STOCK_ADJUST: 'inventory:stock:adjust',
} as const;
