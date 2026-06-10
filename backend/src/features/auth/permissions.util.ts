import { SystemPermissions } from './constants/permissions.enum';

/** Normaliza el JSON de TenantRole.permissions a un arreglo de strings. */
export function parseTenantRolePermissions(permissions: unknown): string[] {
  if (!Array.isArray(permissions)) {
    return [];
  }
  return permissions.filter((p): p is string => typeof p === 'string');
}

export type PermissionBearer = {
  role?: string;
  permissions?: string[];
  customRole?: { permissions?: unknown } | null;
};

/** Permisos efectivos: JWT `permissions` o, si faltan, el rol custom cargado. */
export function resolveUserPermissions(
  user: PermissionBearer | null | undefined,
): string[] {
  if (!user) return [];
  if (Array.isArray(user.permissions) && user.permissions.length > 0) {
    return user.permissions.filter((p): p is string => typeof p === 'string');
  }
  return parseTenantRolePermissions(user.customRole?.permissions);
}

export function userHasGlobalRoleBypass(role: unknown): boolean {
  return role === 'SUPER_ADMIN' || role === 'ADMIN';
}

export function userHasPermission(
  user: PermissionBearer | null | undefined,
  permission: string,
): boolean {
  if (!user) return false;
  if (userHasGlobalRoleBypass(user.role)) return true;
  return resolveUserPermissions(user).includes(permission);
}

export function userHasAnyPermission(
  user: PermissionBearer | null | undefined,
  permissions: string[],
): boolean {
  if (!user) return false;
  if (userHasGlobalRoleBypass(user.role)) return true;
  const granted = new Set(resolveUserPermissions(user));
  return permissions.some((p) => granted.has(p));
}

export function userCanViewInventoryCost(
  user: PermissionBearer | null | undefined,
): boolean {
  return userHasPermission(user, SystemPermissions.INVENTORY_STOCK_VIEW_COST);
}
