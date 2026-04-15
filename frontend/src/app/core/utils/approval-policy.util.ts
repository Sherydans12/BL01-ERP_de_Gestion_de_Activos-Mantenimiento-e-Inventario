/**
 * Alineado con backend `tenant-role-defaults.ts` / `resolveApprovalPolicyForUser`.
 */
const SYSTEM_MIRROR_ROLE_NAME: Record<string, string> = {
  SUPER_ADMIN: 'Sistema · SUPER_ADMIN',
  ADMIN: 'Sistema · ADMIN',
  SUPERVISOR: 'Sistema · SUPERVISOR',
  MECHANIC: 'Sistema · MECHANIC',
};

export function resolveApprovalPolicyForUser<
  T extends { roleId: string; role?: { name: string; baseRole: string } | null },
>(
  policies: T[],
  user: { customRoleId?: string | null; role: string },
): T | undefined {
  if (user.customRoleId) {
    return policies.find((p) => p.roleId === user.customRoleId);
  }
  const mirrorName = SYSTEM_MIRROR_ROLE_NAME[user.role];
  if (!mirrorName || !policies.length) return undefined;
  return policies.find(
    (p) =>
      p.role?.baseRole === user.role && p.role?.name === mirrorName,
  );
}
