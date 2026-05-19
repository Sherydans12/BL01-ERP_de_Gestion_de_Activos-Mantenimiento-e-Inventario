/**
 * Llaves PBAC de Compras (alineadas con backend SystemPermissions y RBAC-PERMISSIONS-CATALOG.md).
 */
export const P = {
  REQUISITION_READ: 'purchases:requisition:read',
  REQUISITION_CREATE: 'purchases:requisition:create',
  REQUISITION_UPDATE_OWN: 'purchases:requisition:update-own',
  REQUISITION_UPDATE_PURCHASING: 'purchases:requisition:update-purchasing',
  REQUISITION_UPDATE_ASSET_LINK: 'purchases:requisition:update-asset-link',
  REQUISITION_SUBMIT: 'purchases:requisition:submit',
  REQUISITION_CANCEL: 'purchases:requisition:cancel',
  REQUISITION_START_QUOTING: 'purchases:requisition:start-quoting',
  REQUISITION_MANAGE_QUOTATIONS: 'purchases:requisition:manage-quotations',
  REQUISITION_AWARD_LINES: 'purchases:requisition:award-lines',
  REQUISITION_DUPLICATE: 'purchases:requisition:duplicate',

  ORDER_READ: 'purchases:order:read',
  ORDER_CREATE_FROM_REQUISITION: 'purchases:order:create-from-requisition',
  ORDER_CREATE_FROM_QUOTATION: 'purchases:order:create-from-quotation',
  ORDER_APPROVE: 'purchases:order:approve',
  ORDER_SEND_TO_SUPPLIER: 'purchases:order:send-to-supplier',
  ORDER_CANCEL: 'purchases:order:cancel',
  ORDER_FORCE_CLOSE: 'purchases:order:force-close',
  ORDER_REJECT: 'purchases:order:reject',
  ORDER_RESET_DRAFT: 'purchases:order:reset-draft',
  ORDER_UPDATE_LOGISTICS: 'purchases:order:update-logistics',
  ORDER_UPDATE_SENSITIVE: 'purchases:order:update-sensitive',
  ORDER_LINK_CATALOG: 'purchases:order:link-catalog',

  RECEIPT_READ: 'purchases:receipt:read',
  RECEIPT_CREATE: 'purchases:receipt:create',
  RECEIPT_REGISTER: 'purchases:receipt:register',

  INVOICE_READ: 'purchases:invoice:read',
  INVOICE_CREATE: 'purchases:invoice:create',
  INVOICE_UPDATE: 'purchases:invoice:update',
  INVOICE_VALIDATE: 'purchases:invoice:validate',
  INVOICE_OVERRULE: 'purchases:invoice:overrule',
  INVOICE_MARK_PAID: 'purchases:invoice:mark-paid',
  INVOICE_DELETE: 'purchases:invoice:delete',

  SETTING_READ: 'purchases:setting:read',
  SETTING_UPDATE: 'purchases:setting:update',
  VENDOR_READ: 'purchases:vendor:read',
  VENDOR_CREATE: 'purchases:vendor:create',
  VENDOR_UPDATE: 'purchases:vendor:update',
  VENDOR_DELETE: 'purchases:vendor:delete',

  DOCUMENT_READ: 'purchases:document:read',
  DOCUMENT_MANAGE: 'purchases:document:manage',
  ANALYTICS_READ: 'purchases:analytics:read',
} as const;

/** Edición de SRC: al menos una capacidad de modificación. */
export const REQUISITION_EDIT_ANY = [
  P.REQUISITION_UPDATE_OWN,
  P.REQUISITION_UPDATE_PURCHASING,
  P.REQUISITION_UPDATE_ASSET_LINK,
] as const;
