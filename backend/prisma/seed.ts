import 'dotenv/config';
import { PrismaClient, CatalogCategory } from '@prisma/client';
import * as bcrypt from 'bcrypt';
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
  // ── TENANT predeterminado (TPM) ──
  console.log('\n🏢 Verificando TENANT predeterminado (TPM)...');
  const tpmTenant = await prisma.tenant.upsert({
    where: { code: 'TPM' },
    update: {},
    create: {
      code: 'TPM',
      name: 'Transportes Portuarios y Minería',
    },
  });

  console.log('🌱 Seeding catalog_items para TPM...');

  for (const item of seedData) {
    await (prisma.catalogItem.upsert as any)({
      where: {
        tenantId_code: {
          tenantId: tpmTenant.id,
          code: item.code,
        },
      },
      update: { name: item.name, category: item.category },
      create: {
        tenantId: tpmTenant.id,
        code: item.code,
        name: item.name,
        category: item.category,
      },
    });
    console.log(`  ✔ ${item.code} — ${item.name}`);
  }

  console.log('\n👤 Verificando usuario ADMIN...');
  const adminEmail = 'admin@tpm.cl';
  const existingAdmin = await prisma.user.findUnique({
    where: { email: adminEmail },
  });

  if (!existingAdmin) {
    const hashedPassword = await bcrypt.hash('admin', 10);
    await prisma.user.create({
      data: {
        email: adminEmail,
        password: hashedPassword,
        name: 'Administrador TPM',
        role: 'ADMIN',
        isActive: true,
        tenantId: tpmTenant.id,
      },
    });
    console.log('  ✔ Usuario ADMIN creado exitosamente (admin@tpm.cl).');
  } else {
    // Asegurar que tenga el tenant asignado si no lo tiene
    if (!existingAdmin.tenantId) {
      await prisma.user.update({
        where: { id: existingAdmin.id },
        data: { tenantId: tpmTenant.id },
      });
      console.log('  ✔ Tenant TPM asignado al usuario ADMIN existente.');
    }
    console.log('  ✔ Usuario ADMIN ya existe.');
  }

  // ── Equipo de Prueba ──
  console.log('\n🚜 Verificando Equipo de Prueba para TPM...');
  const testEquipment = await prisma.equipment.upsert({
    where: {
      tenantId_internalId: {
        tenantId: tpmTenant.id,
        internalId: 'TEST-001',
      },
    } as any,
    update: {},
    create: {
      tenantId: tpmTenant.id,
      internalId: 'TEST-001',
      plate: 'TEST-21',
      type: 'CAMIONETA',
      brand: 'TOYOTA',
      model: 'HILUX',
      currentHorometer: 1000,
    } as any,
  });
  console.log(`  ✔ Equipo de prueba creado: ${testEquipment.internalId}`);

  console.log(`\n✅ Seed completado: ${seedData.length} catálogos procesados.`);
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
