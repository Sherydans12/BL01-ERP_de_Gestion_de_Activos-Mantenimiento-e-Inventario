/**
 * Catálogo maestro de permisos de capacidad (PBAC).
 * Valores alineados con docs/RBAC-PERMISSIONS-CATALOG.md (módulo Compras).
 * Los strings son la fuente de verdad persistida en TenantRole.permissions.
 */
export enum SystemPermissions {
  // —— Requerimientos de compra ——
  PURCHASES_REQUISITION_READ = 'purchases:requisition:read',
  PURCHASES_REQUISITION_CREATE = 'purchases:requisition:create',
  PURCHASES_REQUISITION_UPDATE_OWN = 'purchases:requisition:update-own',
  PURCHASES_REQUISITION_UPDATE_PURCHASING = 'purchases:requisition:update-purchasing',
  PURCHASES_REQUISITION_UPDATE_ASSET_LINK = 'purchases:requisition:update-asset-link',
  PURCHASES_REQUISITION_SUBMIT = 'purchases:requisition:submit',
  PURCHASES_REQUISITION_CANCEL = 'purchases:requisition:cancel',
  PURCHASES_REQUISITION_START_QUOTING = 'purchases:requisition:start-quoting',
  PURCHASES_REQUISITION_MANAGE_QUOTATIONS = 'purchases:requisition:manage-quotations',
  PURCHASES_REQUISITION_AWARD_LINES = 'purchases:requisition:award-lines',
  PURCHASES_REQUISITION_DUPLICATE = 'purchases:requisition:duplicate',

  // —— Órdenes de compra ——
  PURCHASES_ORDER_READ = 'purchases:order:read',
  PURCHASES_ORDER_CREATE_FROM_REQUISITION = 'purchases:order:create-from-requisition',
  PURCHASES_ORDER_CREATE_FROM_QUOTATION = 'purchases:order:create-from-quotation',
  PURCHASES_ORDER_APPROVE = 'purchases:order:approve',
  PURCHASES_ORDER_SEND_TO_SUPPLIER = 'purchases:order:send-to-supplier',
  PURCHASES_ORDER_CANCEL = 'purchases:order:cancel',
  PURCHASES_ORDER_FORCE_CLOSE = 'purchases:order:force-close',
  PURCHASES_ORDER_REJECT = 'purchases:order:reject',
  PURCHASES_ORDER_RESET_DRAFT = 'purchases:order:reset-draft',
  PURCHASES_ORDER_UPDATE_LOGISTICS = 'purchases:order:update-logistics',
  PURCHASES_ORDER_UPDATE_SENSITIVE = 'purchases:order:update-sensitive',
  PURCHASES_ORDER_LINK_CATALOG = 'purchases:order:link-catalog',

  // —— Recepciones de bodega ——
  PURCHASES_RECEIPT_READ = 'purchases:receipt:read',
  PURCHASES_RECEIPT_CREATE = 'purchases:receipt:create',
  PURCHASES_RECEIPT_REGISTER = 'purchases:receipt:register',

  // —— Facturas y conciliación ——
  PURCHASES_INVOICE_READ = 'purchases:invoice:read',
  PURCHASES_INVOICE_CREATE = 'purchases:invoice:create',
  PURCHASES_INVOICE_UPDATE = 'purchases:invoice:update',
  PURCHASES_INVOICE_VALIDATE = 'purchases:invoice:validate',
  PURCHASES_INVOICE_OVERRULE = 'purchases:invoice:overrule',
  PURCHASES_INVOICE_MARK_PAID = 'purchases:invoice:mark-paid',
  PURCHASES_INVOICE_DELETE = 'purchases:invoice:delete',
  PURCHASES_CREDIT_NOTE_MANAGE = 'purchases:credit-note:manage',

  // —— Configuración y proveedores ——
  PURCHASES_SETTING_READ = 'purchases:setting:read',
  PURCHASES_SETTING_UPDATE = 'purchases:setting:update',
  PURCHASES_VENDOR_READ = 'purchases:vendor:read',
  PURCHASES_VENDOR_CREATE = 'purchases:vendor:create',
  PURCHASES_VENDOR_UPDATE = 'purchases:vendor:update',
  PURCHASES_VENDOR_DELETE = 'purchases:vendor:delete',

  // —— Transversal compras ——
  PURCHASES_DOCUMENT_READ = 'purchases:document:read',
  PURCHASES_DOCUMENT_MANAGE = 'purchases:document:manage',
  PURCHASES_ANALYTICS_READ = 'purchases:analytics:read',

  // —— Inventario: artículos ——
  INVENTORY_ITEM_READ = 'inventory:item:read',
  INVENTORY_ITEM_CREATE = 'inventory:item:create',
  INVENTORY_ITEM_UPDATE = 'inventory:item:update',
  INVENTORY_ITEM_DELETE = 'inventory:item:delete',

  // —— Inventario: bodegas ——
  INVENTORY_WAREHOUSE_READ = 'inventory:warehouse:read',
  INVENTORY_WAREHOUSE_MANAGE = 'inventory:warehouse:manage',

  // —— Inventario: categorías / familias ——
  INVENTORY_CATEGORY_READ = 'inventory:category:read',
  INVENTORY_CATEGORY_MANAGE = 'inventory:category:manage',

  // —— Inventario: transferencias W2W ——
  INVENTORY_TRANSFER_READ = 'inventory:transfer:read',
  INVENTORY_TRANSFER_CREATE = 'inventory:transfer:create',
  INVENTORY_TRANSFER_APPROVE = 'inventory:transfer:approve',

  // —— Inventario: stock y ajustes ——
  INVENTORY_STOCK_READ = 'inventory:stock:read',
  INVENTORY_STOCK_ADJUST = 'inventory:stock:adjust',
}
