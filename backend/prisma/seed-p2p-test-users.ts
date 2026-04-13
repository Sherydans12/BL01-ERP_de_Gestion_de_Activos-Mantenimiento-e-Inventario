/**
 * Usuarios de prueba para el módulo P2P (compras).
 *
 * Uso:
 *   cd backend && npx ts-node prisma/seed-p2p-test-users.ts
 *
 * Variables opcionales (.env):
 *   TENANT_CODE=TPM   (código del tenant; por defecto TPM)
 *
 * Contraseña para todos: Test1234!
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

const PASSWORD_PLAIN = 'Test1234!';

const TEST_USERS: Array<{
  email: string;
  name: string;
  role: UserRole;
}> = [
  {
    email: 'mecanico@test.com',
    name: 'Juan Mecánico',
    role: UserRole.MECHANIC,
  },
  {
    email: 'admin@test.com',
    name: 'Administrador Compras',
    role: UserRole.ADMIN,
  },
  {
    email: 'supervisor@test.com',
    name: 'Supervisor Operativo',
    role: UserRole.SUPERVISOR,
  },
  {
    email: 'gerente@test.com',
    name: 'Gerente General',
    role: UserRole.SUPER_ADMIN,
  },
];

async function main() {
  const tenantCode = (process.env.TENANT_CODE || 'TPM').trim().toUpperCase();

  const tenant = await prisma.tenant.findUnique({
    where: { code: tenantCode },
  });
  if (!tenant) {
    throw new Error(
      `No existe tenant con código "${tenantCode}". Ajuste TENANT_CODE o ejecute el seed principal.`,
    );
  }

  await ensureDefaultTenantRolesForTenant(prisma, tenant.id);

  const contracts = await prisma.contract.findMany({
    where: { tenantId: tenant.id, isActive: true },
    select: { id: true },
  });
  const contractIds = contracts.map((c) => c.id);

  const hashedPassword = await bcrypt.hash(PASSWORD_PLAIN, 10);

  console.log(`\n📌 Tenant: ${tenant.code} (${tenant.id})\n`);

  for (const spec of TEST_USERS) {
    const mirrorName = SYSTEM_MIRROR_ROLE_NAME[spec.role];
    const tenantRole = await prisma.tenantRole.findFirst({
      where: { tenantId: tenant.id, name: mirrorName },
    });
    if (!tenantRole) {
      throw new Error(`Falta rol de tenant: ${mirrorName}`);
    }

    const user = await prisma.user.upsert({
      where: { email: spec.email },
      update: {
        password: hashedPassword,
        name: spec.name,
        role: spec.role,
        isActive: true,
        tenantId: tenant.id,
        customRoleId: tenantRole.id,
        activationToken: null,
      },
      create: {
        email: spec.email,
        password: hashedPassword,
        name: spec.name,
        role: spec.role,
        isActive: true,
        tenantId: tenant.id,
        customRoleId: tenantRole.id,
      },
    });

    await prisma.userContract.deleteMany({ where: { userId: user.id } });

    if (spec.role === 'ADMIN' || spec.role === 'SUPER_ADMIN') {
      // AuthService asigna allowedContracts = ['ALL'] sin filas en user_contracts.
    } else if (contractIds.length > 0) {
      await prisma.userContract.createMany({
        data: contractIds.map((contractId) => ({
          userId: user.id,
          contractId,
        })),
      });
    } else {
      console.warn(
        `  ⚠ ${spec.email}: sin contratos activos en el tenant; asigne contratos manualmente.`,
      );
    }

    console.log(
      `  ✓ ${spec.email} → ${spec.role} | Rol tenant: ${mirrorName} | Activo`,
    );
  }

  console.log(`\n✅ Listo. Contraseña común: ${PASSWORD_PLAIN}\n`);
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
