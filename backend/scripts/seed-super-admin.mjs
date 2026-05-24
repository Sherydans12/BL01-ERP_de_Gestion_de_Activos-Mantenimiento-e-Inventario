/**
 * Seed SUPER_ADMIN para contenedor Docker (sin ts-node ni carpeta src/).
 * Uso: cd /app && npm run seed:super-admin
 *
 * Env: TENANT_CODE, SUPER_ADMIN_EMAIL, SUPER_ADMIN_NAME, SUPER_ADMIN_PASSWORD, DATABASE_URL
 */
import bcrypt from 'bcrypt';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, UserRole } from '@prisma/client';

const SYSTEM_MIRROR_ROLE_NAME = {
  [UserRole.SUPER_ADMIN]: 'Sistema · SUPER_ADMIN',
  [UserRole.ADMIN]: 'Sistema · ADMIN',
  [UserRole.USER]: 'Sistema · USER',
};

const ROLE_DESCRIPTIONS = {
  [UserRole.SUPER_ADMIN]:
    'Rol base (espejo). Asignable en matriz de firmas; equivale a SUPER_ADMIN del usuario.',
  [UserRole.ADMIN]:
    'Rol base (espejo). Asignable en matriz de firmas; equivale a ADMIN del usuario.',
  [UserRole.USER]:
    'Rol base (espejo). Sin privilegios por defecto; pizarra en blanco para permisos y menú.',
};

const TENANT_DEFAULT_MIRROR_ROLES = [UserRole.ADMIN, UserRole.USER];

async function ensureMirrorRole(prisma, tenantId, baseRole) {
  const name = SYSTEM_MIRROR_ROLE_NAME[baseRole];
  const existing = await prisma.tenantRole.findFirst({
    where: { tenantId, name },
    select: { id: true },
  });
  if (existing) return;
  await prisma.tenantRole.create({
    data: {
      tenantId,
      name,
      description: ROLE_DESCRIPTIONS[baseRole],
      baseRole,
      routes: [],
    },
  });
}

async function ensureDefaultTenantRoles(prisma, tenantId) {
  for (const baseRole of TENANT_DEFAULT_MIRROR_ROLES) {
    await ensureMirrorRole(prisma, tenantId, baseRole);
  }
  await ensureMirrorRole(prisma, tenantId, UserRole.SUPER_ADMIN);
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  const tenantCode = (process.env.TENANT_CODE || 'TPM').trim().toUpperCase();
  const email = (process.env.SUPER_ADMIN_EMAIL || 'superadmin@test.com')
    .trim()
    .toLowerCase();
  const name = (process.env.SUPER_ADMIN_NAME || 'Super Administrador').trim();
  const passwordPlain = (process.env.SUPER_ADMIN_PASSWORD || 'Test1234!').trim();

  const pool = new pg.Pool({ connectionString: url });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    let tenant = await prisma.tenant.findUnique({ where: { code: tenantCode } });
    if (!tenant) {
      tenant = await prisma.tenant.create({
        data: {
          code: tenantCode,
          name: `${tenantCode} QA`,
          primaryColor: '#00B4D8',
          isActive: true,
        },
      });
      console.log(`Tenant "${tenantCode}" creado (${tenant.id})`);
    }

    await ensureDefaultTenantRoles(prisma, tenant.id);

    const mirrorName = SYSTEM_MIRROR_ROLE_NAME[UserRole.SUPER_ADMIN];
    const tenantRole = await prisma.tenantRole.findFirst({
      where: { tenantId: tenant.id, name: mirrorName },
    });
    if (!tenantRole) {
      throw new Error(`Falta rol de tenant: ${mirrorName}`);
    }

    const hashedPassword = await bcrypt.hash(passwordPlain, 10);

    const user = await prisma.user.upsert({
      where: { email },
      update: {
        password: hashedPassword,
        name,
        role: UserRole.SUPER_ADMIN,
        isActive: true,
        tenantId: tenant.id,
        customRoleId: tenantRole.id,
        activationToken: null,
      },
      create: {
        email,
        password: hashedPassword,
        name,
        role: UserRole.SUPER_ADMIN,
        isActive: true,
        tenantId: tenant.id,
        customRoleId: tenantRole.id,
      },
    });

    await prisma.userContract.deleteMany({ where: { userId: user.id } });

    console.log('\n✅ Usuario SUPER_ADMIN listo\n');
    console.log(`   Tenant:     ${tenant.code}`);
    console.log(`   Email:      ${email}`);
    console.log(`   Nombre:     ${name}`);
    console.log(`   Rol tenant: ${mirrorName}`);
    console.log(`   Contraseña: ${passwordPlain}\n`);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
