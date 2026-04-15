/**
 * Carga idempotente de Catálogos Maestros (diccionarios de flota / OT).
 *
 * Uso: cd backend && npm run seed:catalog-masters
 *
 * Variables: TENANT_CODE (default TPM)
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import {
  CATALOG_MASTER_ITEMS,
  upsertCatalogMastersForTenant,
} from './data/catalog-master-items';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
// eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- pg vs @prisma/adapter-pg nested @types/pg mismatch
const adapter = new PrismaPg(pool as any);
const prisma = new PrismaClient({ adapter });

async function main() {
  const tenantCode = (process.env.TENANT_CODE || 'TPM').trim().toUpperCase();
  const tenant = await prisma.tenant.findUnique({
    where: { code: tenantCode },
    select: { id: true, code: true },
  });
  if (!tenant) {
    throw new Error(`No existe tenant "${tenantCode}".`);
  }

  await upsertCatalogMastersForTenant(prisma, tenant.id);
  console.log(
    `✅ Catálogos maestros actualizados (${CATALOG_MASTER_ITEMS.length} filas) para tenant ${tenant.code}.`,
  );
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
