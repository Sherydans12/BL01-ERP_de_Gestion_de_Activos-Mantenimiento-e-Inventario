/**
 * Crea o actualiza un usuario con rol base SUPER_ADMIN y rol de tenant "Sistema · SUPER_ADMIN".
 *
 * Uso:
 *   cd backend && npm run seed:super-admin
 *
 * Variables opcionales (.env o entorno):
 *   TENANT_CODE=TPM
 *   SUPER_ADMIN_EMAIL=superadmin@test.com
 *   SUPER_ADMIN_NAME=Super Administrador
 *   SUPER_ADMIN_PASSWORD=Test1234!
 */
import 'dotenv/config';
import { PrismaClient, UserRole } from '@prisma/client';
import {
  ensureDefaultTenantRolesForTenant,
  SYSTEM_MIRROR_ROLE_NAME,
} from '../src/features/tenant-roles/tenant-role-defaults';
import * as bcrypt from 'bcrypt';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool as any);
const prisma = new PrismaClient({ adapter });

async function main() {
  const tenantCode = (process.env.TENANT_CODE || 'TPM').trim().toUpperCase();
  const email = (process.env.SUPER_ADMIN_EMAIL || 'superadmin@test.com').trim().toLowerCase();
  const name = (process.env.SUPER_ADMIN_NAME || 'Super Administrador').trim();
  const passwordPlain = (process.env.SUPER_ADMIN_PASSWORD || 'Test1234!').trim();

  const tenant = await prisma.tenant.findUnique({
    where: { code: tenantCode },
  });
  if (!tenant) {
    throw new Error(
      `No existe tenant "${tenantCode}". Use TENANT_CODE o ejecute el seed principal.`,
    );
  }

  await ensureDefaultTenantRolesForTenant(prisma, tenant.id);

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
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
