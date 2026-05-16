/**
 * Resuelve qué política de aprobación corresponde al usuario
 * buscando su `id` en `allowedUsers` de cada política.
 * Alineado con el backend `resolveApprovalPolicyForUser`.
 */
export function resolveApprovalPolicyForUser<
  T extends { allowedUsers: Array<{ userId: string }> },
>(
  policies: T[],
  user: { id: string },
): T | undefined {
  return policies.find((p) =>
    p.allowedUsers.some((au) => au.userId === user.id),
  );
}
