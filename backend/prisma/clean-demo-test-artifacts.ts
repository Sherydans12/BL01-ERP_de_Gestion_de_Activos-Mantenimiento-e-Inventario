/**
 * Elimina ítems de carga masiva (prefijo LOAD-) del tenant.
 * Usuarios @test.com / roles PBAC los limpia la fase siguiente (db:clean-bootstrap-tpm).
 *
 * Uso: cd backend && npm run db:clean-demo-artifacts
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
// eslint-disable-next-line @typescript-eslint/no-unsafe-argument
const adapter = new PrismaPg(pool as any);
const prisma = new PrismaClient({ adapter });

async function cleanLoadTestItems(tenantId: string | null): Promise<void> {
  const whereByTenant = tenantId ? { tenantId } : {};
  const loadItems = await prisma.inventoryItem.findMany({
    where: { ...whereByTenant, partNumber: { startsWith: 'LOAD-' } },
    select: { id: true },
    take: 50_000,
  });
  if (!loadItems.length) {
    console.log('  · Sin ítems LOAD-');
    return;
  }
  const itemIds = loadItems.map((i) => i.id);
  console.log(`  · Eliminando ${itemIds.length} ítems LOAD-…`);
  await prisma.inventoryItemAttachment.deleteMany({
    where: { itemId: { in: itemIds } },
  });
  await prisma.itemStock.deleteMany({ where: { itemId: { in: itemIds } } });
  await prisma.inventoryTransaction.deleteMany({
    where: { itemId: { in: itemIds } },
  });
  await prisma.inventoryTransferLine.deleteMany({
    where: { itemId: { in: itemIds } },
  });
  await prisma.inventoryItem.deleteMany({ where: { id: { in: itemIds } } });
}

async function main() {
  const tenantCode = (process.env.TENANT_CODE || 'TPM').trim().toUpperCase();
  const tenant = await prisma.tenant.findUnique({
    where: { code: tenantCode },
    select: { id: true, code: true },
  });
  if (!tenant) {
    throw new Error(`No existe tenant "${tenantCode}".`);
  }

  console.log(`\n🧹 Limpieza LOAD- — tenant ${tenant.code}\n`);
  await cleanLoadTestItems(tenant.id);
  console.log('\n✅ Artefactos LOAD- eliminados.\n');
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
