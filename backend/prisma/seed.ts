import 'dotenv/config';
import { PrismaClient, CatalogCategory } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool as any);
const prisma = new PrismaClient({ adapter });

interface SeedItem {
  code: string;
  name: string;
  category: CatalogCategory;
}

const seedData: SeedItem[] = [
  // ── Tipos de Equipo ──
  { code: 'EQT-01', name: 'CAMIONETA', category: 'EQUIPMENT_TYPE' },
  { code: 'EQT-02', name: 'CAMIÓN ALJIBE', category: 'EQUIPMENT_TYPE' },
  { code: 'EQT-03', name: 'BULLDOZER', category: 'EQUIPMENT_TYPE' },

  // ── Marcas ──
  { code: 'BRD-01', name: 'TOYOTA', category: 'BRAND' },
  { code: 'BRD-02', name: 'FOTON', category: 'BRAND' },
  { code: 'BRD-03', name: 'CATERPILLAR', category: 'BRAND' },

  // ── Sistemas ──
  { code: 'SYS-01', name: 'MOTOR', category: 'SYSTEM' },
  { code: 'SYS-02', name: 'TRANSMISIÓN', category: 'SYSTEM' },
  { code: 'SYS-03', name: 'FRENOS', category: 'SYSTEM' },
  { code: 'SYS-04', name: 'SISTEMA ELÉCTRICO', category: 'SYSTEM' },
  { code: 'SYS-05', name: 'SISTEMA HIDRÁULICO', category: 'SYSTEM' },

  // ── Fluidos ──
  { code: 'FLD-01', name: 'ACEITE MOTOR 15W40', category: 'FLUID' },
  { code: 'FLD-02', name: 'ACEITE HIDRÁULICO 68', category: 'FLUID' },
];

async function main() {
  console.log('🌱 Seeding catalog_items...');

  for (const item of seedData) {
    await prisma.catalogItem.upsert({
      where: { code: item.code },
      update: { name: item.name, category: item.category },
      create: { code: item.code, name: item.name, category: item.category },
    });
    console.log(`  ✔ ${item.code} — ${item.name}`);
  }

  console.log(`\n✅ Seed completado: ${seedData.length} registros procesados.`);
}

main()
  .catch((e) => {
    console.error('❌ Error en seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
