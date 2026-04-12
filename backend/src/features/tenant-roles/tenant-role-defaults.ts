import { PrismaClient, UserRole } from '@prisma/client';

/**
 * Nombres reservados para roles espejo del enum UserRole.
 * No deben renombrarse en UI si se quiere que la firma por rol base
 * (sin customRoleId) siga funcionando.
 */
export const SYSTEM_MIRROR_ROLE_NAME: Record<UserRole, string> = {
  SUPER_ADMIN: 'Sistema · SUPER_ADMIN',
  ADMIN: 'Sistema · ADMIN',
  SUPERVISOR: 'Sistema · SUPERVISOR',
  MECHANIC: 'Sistema · MECHANIC',
};

const DESCRIPTIONS: Record<UserRole, string> = {
  SUPER_ADMIN:
    'Rol base (espejo). Asignable en matriz de firmas; equivale a SUPER_ADMIN del usuario.',
  ADMIN:
    'Rol base (espejo). Asignable en matriz de firmas; equivale a ADMIN del usuario.',
  SUPERVISOR:
    'Rol base (espejo). Asignable en matriz de firmas; equivale a SUPERVISOR del usuario.',
  MECHANIC:
    'Rol base (espejo). Asignable en matriz de firmas; equivale a MECHANIC del usuario.',
};

const ALL_ROLES: UserRole[] = [
  UserRole.SUPER_ADMIN,
  UserRole.ADMIN,
  UserRole.SUPERVISOR,
  UserRole.MECHANIC,
];

/**
 * Crea en tenant_roles los cuatro roles espejo si faltan (idempotente).
 */
export async function ensureDefaultTenantRolesForTenant(
  db: Pick<PrismaClient, 'tenantRole'>,
  tenantId: string,
): Promise<void> {
  for (const baseRole of ALL_ROLES) {
    const name = SYSTEM_MIRROR_ROLE_NAME[baseRole];
    const existing = await db.tenantRole.findFirst({
      where: { tenantId, name },
      select: { id: true },
    });
    if (existing) continue;
    await db.tenantRole.create({
      data: {
        tenantId,
        name,
        description: DESCRIPTIONS[baseRole],
        baseRole,
        routes: [],
      },
    });
  }
}

/**
 * Resuelve qué política de aprobación aplica al usuario:
 * - Si tiene customRoleId, solo coincide por roleId exacto.
 * - Si no tiene rol personalizado, coincide con el TenantRole espejo cuyo nombre
 *   y baseRole coinciden con User.role.
 */
export function resolveApprovalPolicyForUser<
  T extends {
    roleId: string;
    role: { name: string; baseRole: UserRole };
  },
>(policies: T[], user: { customRoleId?: string | null; role: UserRole }): T | undefined {
  if (user.customRoleId) {
    return policies.find((p) => p.roleId === user.customRoleId);
  }
  const mirrorName = SYSTEM_MIRROR_ROLE_NAME[user.role];
  return policies.find(
    (p) =>
      p.role.baseRole === user.role && p.role.name === mirrorName,
  );
}
