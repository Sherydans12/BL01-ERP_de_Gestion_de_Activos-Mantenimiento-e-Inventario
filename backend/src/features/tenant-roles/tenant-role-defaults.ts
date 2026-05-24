import { PrismaClient, UserRole } from '@prisma/client';

/**
 * Nombres reservados para roles espejo del enum UserRole.
 * No deben renombrarse en UI si se quiere que la firma por rol base
 * (sin customRoleId) siga funcionando.
 */
export const SYSTEM_MIRROR_ROLE_NAME: Record<UserRole, string> = {
  SUPER_ADMIN: 'Sistema · SUPER_ADMIN',
  ADMIN: 'Sistema · ADMIN',
  USER: 'Sistema · USER',
};

const DESCRIPTIONS: Record<UserRole, string> = {
  SUPER_ADMIN:
    'Rol base (espejo). Asignable en matriz de firmas; equivale a SUPER_ADMIN del usuario.',
  ADMIN:
    'Rol base (espejo). Asignable en matriz de firmas; equivale a ADMIN del usuario.',
  USER:
    'Rol base (espejo). Sin privilegios por defecto; pizarra en blanco para permisos y menú.',
};

/** Roles espejo creados al provisionar un tenant (PBAC). */
const TENANT_DEFAULT_MIRROR_ROLES: UserRole[] = [UserRole.ADMIN, UserRole.USER];

async function ensureMirrorRole(
  db: Pick<PrismaClient, 'tenantRole'>,
  tenantId: string,
  baseRole: UserRole,
): Promise<void> {
  const name = SYSTEM_MIRROR_ROLE_NAME[baseRole];
  const existing = await db.tenantRole.findFirst({
    where: { tenantId, name },
    select: { id: true },
  });
  if (existing) return;
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

/**
 * Crea en tenant_roles los roles espejo ADMIN y USER si faltan (idempotente).
 */
export async function ensureDefaultTenantRolesForTenant(
  db: Pick<PrismaClient, 'tenantRole'>,
  tenantId: string,
): Promise<void> {
  for (const baseRole of TENANT_DEFAULT_MIRROR_ROLES) {
    await ensureMirrorRole(db, tenantId, baseRole);
  }
}

/** Rol espejo SUPER_ADMIN (seed de plataforma; no se crea en cada tenant por defecto). */
export async function ensureSuperAdminMirrorRole(
  db: Pick<PrismaClient, 'tenantRole'>,
  tenantId: string,
): Promise<void> {
  await ensureMirrorRole(db, tenantId, UserRole.SUPER_ADMIN);
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
