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
  INVENTORY_STOCK_VIEW_COST = 'inventory:stock:view_cost',

  // —— Inventario: proveedores (maestro ligero) ——
  INVENTORY_SUPPLIER_READ = 'inventory:supplier:read',
  INVENTORY_SUPPLIER_MANAGE = 'inventory:supplier:manage',

  // —— Inventario: analítica ——
  INVENTORY_ANALYTICS_READ = 'inventory:analytics:read',
  INVENTORY_ANALYTICS_REPORT = 'inventory:analytics:report',

  // —— Operaciones: flota / equipos ——
  OPERATIONS_EQUIPMENT_READ = 'operations:equipment:read',
  OPERATIONS_EQUIPMENT_CREATE = 'operations:equipment:create',
  OPERATIONS_EQUIPMENT_UPDATE = 'operations:equipment:update',
  OPERATIONS_EQUIPMENT_DELETE = 'operations:equipment:delete',

  // —— Operaciones: órdenes de trabajo ——
  OPERATIONS_WORK_ORDER_READ = 'operations:work-order:read',
  OPERATIONS_WORK_ORDER_CREATE = 'operations:work-order:create',
  OPERATIONS_WORK_ORDER_UPDATE = 'operations:work-order:update',
  OPERATIONS_WORK_ORDER_ASSIGN = 'operations:work-order:assign',
  OPERATIONS_WORK_ORDER_EXECUTE = 'operations:work-order:execute',
  OPERATIONS_WORK_ORDER_CLOSE = 'operations:work-order:close',

  // —— Operaciones: horómetros ——
  OPERATIONS_METER_READING_READ = 'operations:meter-reading:read',
  OPERATIONS_METER_READING_CREATE = 'operations:meter-reading:create',

  // —— Operaciones: pautas PM (kits) ——
  OPERATIONS_MAINTENANCE_READ = 'operations:maintenance:read',
  OPERATIONS_MAINTENANCE_MANAGE = 'operations:maintenance:manage',

  // —— Operaciones: backlog de OT ——
  OPERATIONS_BACKLOG_READ = 'operations:backlog:read',
  OPERATIONS_BACKLOG_MANAGE = 'operations:backlog:manage',

  // —— Operaciones: reporte de consumo de lubricantes ——
  OPERATIONS_LUBE_REPORT_READ = 'operations:lube-report:read',
  OPERATIONS_LUBE_REPORT_CREATE = 'operations:lube-report:create',

  // —— Operaciones: disponibilidad operativa diaria ——
  OPERATIONS_AVAILABILITY_READ = 'operations:availability:read',
  OPERATIONS_AVAILABILITY_CREATE = 'operations:availability:create',
  OPERATIONS_AVAILABILITY_MONITOR = 'operations:availability:monitor',

  // —— Operaciones: registro de fallas (correctivo imprevisto) ——
  OPERATIONS_FAULT_REPORT_READ = 'operations:fault-report:read',
  OPERATIONS_FAULT_REPORT_CREATE = 'operations:fault-report:create',
  OPERATIONS_FAULT_REPORT_MANAGE = 'operations:fault-report:manage',

  // —— Administración: usuarios ——
  ADMIN_USER_READ = 'admin:user:read',
  ADMIN_USER_CREATE = 'admin:user:create',
  ADMIN_USER_UPDATE = 'admin:user:update',
  ADMIN_USER_DELETE = 'admin:user:delete',
  ADMIN_USER_MANAGE_ROLES = 'admin:user:manage-roles',

  // —— Administración: configuración tenant / empresa ——
  ADMIN_TENANT_CONFIG_READ = 'admin:tenant-config:read',
  ADMIN_TENANT_CONFIG_UPDATE = 'admin:tenant-config:update',

  // —— Administración: contratos y subcontratos ——
  ADMIN_CONTRACT_READ = 'admin:contract:read',
  ADMIN_CONTRACT_MANAGE = 'admin:contract:manage',

  // —— Administración: notificaciones ——
  ADMIN_NOTIFICATION_READ = 'admin:notification:read',
  ADMIN_NOTIFICATION_MANAGE_SETTINGS = 'admin:notification:manage-settings',

  // —— Core ——
  CORE_DASHBOARD_READ = 'core:dashboard:read',
}
