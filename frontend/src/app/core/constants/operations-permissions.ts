/**
 * Llaves PBAC de Operaciones (alineadas con backend SystemPermissions).
 */
export const O = {
  EQUIPMENT_READ: 'operations:equipment:read',
  EQUIPMENT_CREATE: 'operations:equipment:create',
  EQUIPMENT_UPDATE: 'operations:equipment:update',
  EQUIPMENT_DELETE: 'operations:equipment:delete',

  WORK_ORDER_READ: 'operations:work-order:read',
  WORK_ORDER_CREATE: 'operations:work-order:create',
  WORK_ORDER_UPDATE: 'operations:work-order:update',
  WORK_ORDER_ASSIGN: 'operations:work-order:assign',
  WORK_ORDER_EXECUTE: 'operations:work-order:execute',
  WORK_ORDER_CLOSE: 'operations:work-order:close',

  METER_READING_READ: 'operations:meter-reading:read',
  METER_READING_CREATE: 'operations:meter-reading:create',

  MAINTENANCE_READ: 'operations:maintenance:read',
  MAINTENANCE_MANAGE: 'operations:maintenance:manage',

  BACKLOG_READ: 'operations:backlog:read',
  BACKLOG_MANAGE: 'operations:backlog:manage',
} as const;

/** Mutación de OT en formulario (planificación, asignación o ejecución). */
export const WORK_ORDER_FORM_EDIT_ANY = [
  O.WORK_ORDER_UPDATE,
  O.WORK_ORDER_ASSIGN,
  O.WORK_ORDER_EXECUTE,
] as const;
