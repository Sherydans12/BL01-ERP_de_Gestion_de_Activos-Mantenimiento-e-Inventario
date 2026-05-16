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
 * Resuelve qué política de aprobación corresponde al usuario buscando
 * su `id` en la tabla intermedia `allowedUsers` de cada política.
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
