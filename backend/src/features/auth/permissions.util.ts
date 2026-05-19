/** Normaliza el JSON de TenantRole.permissions a un arreglo de strings. */
export function parseTenantRolePermissions(permissions: unknown): string[] {
  if (!Array.isArray(permissions)) {
    return [];
  }
  return permissions.filter((p): p is string => typeof p === 'string');
}
