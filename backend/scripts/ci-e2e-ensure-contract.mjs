/**
 * Asegura al menos un contrato activo para seeds PBAC / E2E en CI (Postgres vacío).
 * Requiere tenant TPM (npm run seed:super-admin).
 */
import 'dotenv/config';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
  const tenantCode = (process.env.TENANT_CODE || 'TPM').trim().toUpperCase();
  const tenant = await prisma.tenant.findUnique({ where: { code: tenantCode } });
  if (!tenant) {
    throw new Error(`No existe tenant "${tenantCode}". Ejecutá seed:super-admin primero.`);
  }

  const existing = await prisma.contract.findFirst({
    where: { tenantId: tenant.id, isActive: true },
    orderBy: { code: 'asc' },
  });
  if (existing) {
    console.log(`✓ Contrato activo: ${existing.code} (${existing.id})`);
    return;
  }

  const created = await prisma.contract.create({
    data: {
      tenantId: tenant.id,
      code: 'E2E-01',
      name: 'Contrato E2E CI',
      isActive: true,
    },
  });
  console.log(`✓ Contrato creado: ${created.code} (${created.id})`);
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
