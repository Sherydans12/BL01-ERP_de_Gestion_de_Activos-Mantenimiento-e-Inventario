/**
 * Seed: Unidades de Medida y Bodegas maestras para el tenant TPM.
 *
 * Idempotente: usa upsert / findFirst + create según corresponda.
 *
 * Uso: cd backend && npm run seed:inventory-masters
 * Opciones de entorno:
 *   TENANT_CODE=TPM (default)
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
// eslint-disable-next-line @typescript-eslint/no-unsafe-argument
const adapter = new PrismaPg(pool as any);
const prisma = new PrismaClient({ adapter });

// ─────────────────────────────────────────────────────────────────────────────
// Unidades de medida
// ─────────────────────────────────────────────────────────────────────────────
const UOM_ROWS: ReadonlyArray<{ name: string; abbreviation: string; allowsDecimals: boolean }> = [
  { name: 'Unidades',    abbreviation: 'UN',  allowsDecimals: false },
  { name: 'Kilogramos',  abbreviation: 'KG',  allowsDecimals: true  },
  { name: 'Litros',      abbreviation: 'LT',  allowsDecimals: true  },
  { name: 'Litros',      abbreviation: 'LTS', allowsDecimals: true  }, // alias usado en algunos Excel
  { name: 'Metros',      abbreviation: 'MT',  allowsDecimals: true  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Bodegas (5 en total, según listado de operaciones)
//   contractCode → código de contrato existente al que se asocia la bodega
// ─────────────────────────────────────────────────────────────────────────────
const WAREHOUSE_ROWS: ReadonlyArray<{
  code: string;
  name: string;
  location: string;
  contractCode: string;
}> = [
  {
    code: '00',
    name: 'Bodega Copiapó — Tránsito y Otros',
    location: 'Copiapó',
    contractCode: '000',
  },
  {
    code: '395',
    name: 'Bodega Central Caserones',
    location: 'Caserones',
    contractCode: '395',
  },
  {
    code: '448',
    name: 'Bodega Cover',
    location: 'Cover',
    contractCode: '448',
  },
  {
    code: 'PEND-01',
    name: 'Bodega Pendiente 01 (código editable)',
    location: '',
    contractCode: '000',
  },
  {
    code: 'PEND-02',
    name: 'Bodega Pendiente 02 (código editable)',
    location: '',
    contractCode: '000',
  },
];

async function main() {
  const tenantCode = (process.env.TENANT_CODE ?? 'TPM').trim().toUpperCase();

  const tenant = await prisma.tenant.findUnique({
    where: { code: tenantCode },
    select: { id: true, code: true },
  });
  if (!tenant) throw new Error(`No existe tenant "${tenantCode}".`);

  console.log(`\n🏭  Tenant: ${tenant.code} (${tenant.id})`);

  // ── UoM ──────────────────────────────────────────────────────────────────
  console.log('\n📐  Unidades de medida:');
  for (const row of UOM_ROWS) {
    await prisma.unitOfMeasure.upsert({
      where: {
        tenantId_abbreviation: {
          tenantId: tenant.id,
          abbreviation: row.abbreviation,
        },
      },
      update: { name: row.name, allowsDecimals: row.allowsDecimals },
      create: { tenantId: tenant.id, name: row.name, abbreviation: row.abbreviation, allowsDecimals: row.allowsDecimals },
    });
    console.log(`  ✅  ${row.abbreviation} — ${row.name}`);
  }

  // ── Bodegas ───────────────────────────────────────────────────────────────
  console.log('\n🏪  Bodegas:');
  for (const wh of WAREHOUSE_ROWS) {
    const contract = await prisma.contract.findFirst({
      where: {
        tenantId: tenant.id,
        OR: [
          { code: wh.contractCode },
          { code: { startsWith: wh.contractCode } },
        ],
      },
      select: { id: true, code: true, name: true },
    });

    if (!contract) {
      console.warn(
        `  ⚠️  OMITIDA "${wh.name}" — no existe contrato con código "${wh.contractCode}".`,
      );
      continue;
    }

    const existing = await prisma.warehouse.findFirst({
      where: { tenantId: tenant.id, code: wh.code },
      select: { id: true },
    });

    if (existing) {
      await prisma.warehouse.update({
        where: { id: existing.id },
        data: {
          name: wh.name,
          location: wh.location || null,
          isActive: true,
        },
      });
      console.log(`  🔄  [actualizada] ${wh.code} — ${wh.name}`);
    } else {
      await prisma.warehouse.create({
        data: {
          tenantId: tenant.id,
          contractId: contract.id,
          code: wh.code,
          name: wh.name,
          location: wh.location || null,
          type: 'PHYSICAL',
          isActive: true,
        },
      });
      console.log(`  ✅  [creada]     ${wh.code} — ${wh.name} (contrato: ${contract.code})`);
    }
  }

  console.log('\n✅  seed-inventory-masters finalizado.\n');
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
