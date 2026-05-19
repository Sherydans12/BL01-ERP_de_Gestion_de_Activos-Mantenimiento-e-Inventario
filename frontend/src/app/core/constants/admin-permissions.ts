/**
 * Llaves PBAC de Administración, Configuración y Dashboard (alineadas con SystemPermissions).
 */
export const A = {
  USER_READ: 'admin:user:read',
  USER_CREATE: 'admin:user:create',
  USER_UPDATE: 'admin:user:update',
  USER_DELETE: 'admin:user:delete',
  USER_MANAGE_ROLES: 'admin:user:manage-roles',

  TENANT_CONFIG_READ: 'admin:tenant-config:read',
  TENANT_CONFIG_UPDATE: 'admin:tenant-config:update',

  CONTRACT_READ: 'admin:contract:read',
  CONTRACT_MANAGE: 'admin:contract:manage',

  NOTIFICATION_READ: 'admin:notification:read',
  NOTIFICATION_MANAGE_SETTINGS: 'admin:notification:manage-settings',

  DASHBOARD_READ: 'core:dashboard:read',
} as const;
