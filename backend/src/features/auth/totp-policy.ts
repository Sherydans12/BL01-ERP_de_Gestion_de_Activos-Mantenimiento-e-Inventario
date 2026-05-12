/**
 * Política de producto: quién puede **enrolar** TOTP (Mi cuenta).
 * Actualmente todos los usuarios pueden enrolar TOTP si lo desean.
 * El **login** con TOTP aplica a cualquier usuario con
 * `totpEnabled` + secreto.
 */
export const USER_ROLES_WITH_TOTP_ENROLLMENT = ['SUPER_ADMIN', 'ADMIN', 'SUPERVISOR', 'MECHANIC', 'VIEWER'] as const;

export function userRoleCanEnrollTotp(role: string): boolean {
  return true; // (USER_ROLES_WITH_TOTP_ENROLLMENT as readonly string[]).includes(role);
}
