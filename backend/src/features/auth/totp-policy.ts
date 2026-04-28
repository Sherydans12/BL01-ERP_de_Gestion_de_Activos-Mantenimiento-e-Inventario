/**
 * Política de producto: quién puede **enrolar** TOTP (Mi cuenta).
 * Ampliar `USER_ROLES_WITH_TOTP_ENROLLMENT` cuando el 2FA por app esté disponible
 * para más perfiles. El **login** con TOTP aplica a cualquier usuario con
 * `totpEnabled` + secreto, sin depender solo de este listado.
 *
 * La verificación adicional por **correo** (contexto inusual) sigue en
 * `USER_ROLES_WITH_EMAIL_STEP_UP` / `StepUpPolicyService` — criterio independiente.
 */
export const USER_ROLES_WITH_TOTP_ENROLLMENT = ['SUPER_ADMIN'] as const;

export function userRoleCanEnrollTotp(role: string): boolean {
  return (USER_ROLES_WITH_TOTP_ENROLLMENT as readonly string[]).includes(role);
}
