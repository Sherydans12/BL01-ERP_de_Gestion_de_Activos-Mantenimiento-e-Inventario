/**
 * Solo tras despacho administrativo al proveedor puede abrirse recepción física.
 * Incluye SENT_TO_SUPPLIER por datos históricos previos a la migración a SENT.
 */
export const PO_STATUSES_ALLOW_WAREHOUSE_RECEIPT = [
  'SENT',
  'ORDERED',
  'PARTIALLY_RECEIVED',
  'SENT_TO_SUPPLIER',
] as const;
