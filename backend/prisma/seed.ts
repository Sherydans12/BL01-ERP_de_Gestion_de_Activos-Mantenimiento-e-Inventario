import 'dotenv/config';
import { PrismaClient, CatalogCategory, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool as any);
const prisma = new PrismaClient({ adapter });

const seedData = [
  // ── TIPOS DE EQUIPO (EQUIPMENT_TYPE) ──
  {
    code: 'EQT-01',
    name: 'BULLDOZER',
    category: 'EQUIPMENT_TYPE' as CatalogCategory,
  },
  {
    code: 'EQT-02',
    name: 'CAMIONETA',
    category: 'EQUIPMENT_TYPE' as CatalogCategory,
  },
  {
    code: 'EQT-03',
    name: 'CAMIÓN ALJIBE',
    category: 'EQUIPMENT_TYPE' as CatalogCategory,
  },
  {
    code: 'EQT-04',
    name: 'CAMIÓN TOLVA',
    category: 'EQUIPMENT_TYPE' as CatalogCategory,
  },
  {
    code: 'EQT-05',
    name: 'CARGADOR FRONTAL',
    category: 'EQUIPMENT_TYPE' as CatalogCategory,
  },
  {
    code: 'EQT-06',
    name: 'EXCAVADORA',
    category: 'EQUIPMENT_TYPE' as CatalogCategory,
  },
  {
    code: 'EQT-07',
    name: 'GENERADOR ELÉCTRICO',
    category: 'EQUIPMENT_TYPE' as CatalogCategory,
  },
  {
    code: 'EQT-08',
    name: 'GRÚA HORQUILLA',
    category: 'EQUIPMENT_TYPE' as CatalogCategory,
  },
  {
    code: 'EQT-09',
    name: 'MINICARGADOR',
    category: 'EQUIPMENT_TYPE' as CatalogCategory,
  },
  {
    code: 'EQT-10',
    name: 'MOTONIVELADORA',
    category: 'EQUIPMENT_TYPE' as CatalogCategory,
  },

  // ── MARCAS (BRAND) ──
  { code: 'BRD-01', name: 'CATERPILLAR', category: 'BRAND' as CatalogCategory },
  { code: 'BRD-02', name: 'FORD', category: 'BRAND' as CatalogCategory },
  { code: 'BRD-03', name: 'HYUNDAI', category: 'BRAND' as CatalogCategory },
  { code: 'BRD-04', name: 'KOMATSU', category: 'BRAND' as CatalogCategory },
  { code: 'BRD-05', name: 'LIEBHERR', category: 'BRAND' as CatalogCategory },
  {
    code: 'BRD-06',
    name: 'MERCEDES-BENZ',
    category: 'BRAND' as CatalogCategory,
  },
  { code: 'BRD-07', name: 'MITSUBISHI', category: 'BRAND' as CatalogCategory },
  { code: 'BRD-08', name: 'SCANIA', category: 'BRAND' as CatalogCategory },
  { code: 'BRD-09', name: 'TOYOTA', category: 'BRAND' as CatalogCategory },
  { code: 'BRD-10', name: 'VOLVO', category: 'BRAND' as CatalogCategory },

  // ── COMBUSTIBLE (FUEL_TYPE) ──
  { code: 'FUL-00', name: 'N/A', category: 'FUEL_TYPE' as CatalogCategory },
  { code: 'FUL-01', name: 'DIESEL', category: 'FUEL_TYPE' as CatalogCategory },
  {
    code: 'FUL-02',
    name: 'ELÉCTRICO',
    category: 'FUEL_TYPE' as CatalogCategory,
  },
  {
    code: 'FUL-03',
    name: 'GASOLINA 93',
    category: 'FUEL_TYPE' as CatalogCategory,
  },
  {
    code: 'FUL-04',
    name: 'GASOLINA 95',
    category: 'FUEL_TYPE' as CatalogCategory,
  },

  // ── TRACCIÓN / DRIVE (DRIVE_TYPE) ──
  { code: 'DRV-00', name: 'N/A', category: 'DRIVE_TYPE' as CatalogCategory },
  { code: 'DRV-01', name: '4x2', category: 'DRIVE_TYPE' as CatalogCategory },
  { code: 'DRV-02', name: '4x4', category: 'DRIVE_TYPE' as CatalogCategory },
  { code: 'DRV-03', name: '6x4', category: 'DRIVE_TYPE' as CatalogCategory },
  { code: 'DRV-04', name: '8x4', category: 'DRIVE_TYPE' as CatalogCategory },
  {
    code: 'DRV-05',
    name: 'ORUGA (CADENAS)',
    category: 'DRIVE_TYPE' as CatalogCategory,
  },

  // ── PROPIEDAD (OWNERSHIP) ──
  { code: 'OWN-00', name: 'N/A', category: 'OWNERSHIP' as CatalogCategory },
  {
    code: 'OWN-01',
    name: 'ARRENDADO (EXTERNO)',
    category: 'OWNERSHIP' as CatalogCategory,
  },
  { code: 'OWN-02', name: 'LEASING', category: 'OWNERSHIP' as CatalogCategory },
  { code: 'OWN-03', name: 'PROPIO', category: 'OWNERSHIP' as CatalogCategory },

  // ── SISTEMAS (SYSTEM) ──
  { code: 'SYS-01', name: 'MOTOR', category: 'SYSTEM' as CatalogCategory },
  {
    code: 'SYS-02',
    name: 'TRANSMISIÓN',
    category: 'SYSTEM' as CatalogCategory,
  },
  { code: 'SYS-03', name: 'HIDRÁULICO', category: 'SYSTEM' as CatalogCategory },
  { code: 'SYS-04', name: 'ELÉCTRICO', category: 'SYSTEM' as CatalogCategory },
  { code: 'SYS-05', name: 'FRENOS', category: 'SYSTEM' as CatalogCategory },

  // ── FLUIDOS (FLUID) ──
  {
    code: 'FLD-01',
    name: 'ACEITE 15W40',
    category: 'FLUID' as CatalogCategory,
  },
  { code: 'FLD-02', name: 'GRASA EP2', category: 'FLUID' as CatalogCategory },
  {
    code: 'FLD-03',
    name: 'REFRIGERANTE ELC',
    category: 'FLUID' as CatalogCategory,
  },
];

async function main() {
  console.log('🔥 Reseteando base de datos...');

  // 1. TENANT
  const tpmTenant = await prisma.tenant.upsert({
    where: { code: 'TPM' },
    update: {},
    create: { code: 'TPM', name: 'Transportes Portuarios y Minería' },
  });

  // 2. CATÁLOGOS
  console.log('🌱 Poblando diccionarios...');
  for (const item of seedData) {
    await prisma.catalogItem.upsert({
      where: { tenantId_code: { tenantId: tpmTenant.id, code: item.code } },
      update: { name: item.name, category: item.category },
      create: {
        tenantId: tpmTenant.id,
        code: item.code,
        name: item.name,
        category: item.category,
      },
    });
  }

  // 3. SITES
  const siteNorte = await prisma.site.upsert({
    where: { tenantId_code: { tenantId: tpmTenant.id, code: 'FAE-NORTE' } },
    update: {},
    create: {
      tenantId: tpmTenant.id,
      code: 'FAE-NORTE',
      name: 'Faena Norte - Mina Escondida',
    },
  });

  const siteSur = await prisma.site.upsert({
    where: { tenantId_code: { tenantId: tpmTenant.id, code: 'FAE-SUR' } },
    update: {},
    create: {
      tenantId: tpmTenant.id,
      code: 'FAE-SUR',
      name: 'Faena Sur - Puerto Coronel',
    },
  });

  // 4. USUARIOS
  const hashedPassword = await bcrypt.hash('admin123', 10);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@tpm.cl' },
    update: {},
    create: {
      email: 'admin@tpm.cl',
      password: hashedPassword,
      name: 'Nicolás Admin',
      role: UserRole.ADMIN,
      isActive: true,
      tenantId: tpmTenant.id,
      rut: '12.345.678-9',
    },
  });

  // 5. FLOTA DE EQUIPOS (10 Activos con data completa)
  console.log('🚜 Creando flota diversificada...');
  const assets = [
    {
      internalId: 'CAM-001',
      plate: 'VCJW-21',
      type: 'CAMIONETA',
      brand: 'TOYOTA',
      model: 'HILUX DX',
      vin: '8AJFA12PB0012345',
      engineNumber: '2GD-FTV-98',
      year: 2023,
      fuelType: 'DIESEL',
      driveType: '4x4',
      ownership: 'PROPIO',
      maintenanceFrequency: 10000,
      initialHorometer: 0,
      currentHorometer: 15400,
      techReviewExp: new Date('2026-10-15'),
      circPermitExp: new Date('2026-03-31'),
      siteId: siteNorte.id,
    },
    {
      internalId: 'EXC-055',
      plate: null,
      type: 'EXCAVADORA',
      brand: 'CATERPILLAR',
      model: '320 NEXT GEN',
      vin: 'CAT320NG-5544',
      engineNumber: 'C7.1-ACERT',
      year: 2022,
      fuelType: 'DIESEL',
      driveType: 'ORUGA (CADENAS)',
      ownership: 'LEASING',
      maintenanceFrequency: 500,
      initialHorometer: 0,
      currentHorometer: 3210,
      siteId: siteNorte.id,
    },
    {
      internalId: 'TOL-010',
      plate: 'KKB-992',
      type: 'CAMIÓN TOLVA',
      brand: 'SCANIA',
      model: 'G440',
      vin: 'SCAN-G440-1010',
      engineNumber: 'DC13-102',
      year: 2021,
      fuelType: 'DIESEL',
      driveType: '6x4',
      ownership: 'PROPIO',
      maintenanceFrequency: 15000,
      initialHorometer: 0,
      currentHorometer: 85000,
      techReviewExp: new Date('2026-08-20'),
      circPermitExp: new Date('2026-03-31'),
      siteId: siteSur.id,
    },
    {
      internalId: 'BULL-03',
      plate: null,
      type: 'BULLDOZER',
      brand: 'KOMATSU',
      model: 'D155AX-8',
      vin: 'KOM-D155-003',
      engineNumber: 'SAA6D140E-7',
      year: 2020,
      fuelType: 'DIESEL',
      driveType: 'ORUGA (CADENAS)',
      ownership: 'PROPIO',
      maintenanceFrequency: 500,
      initialHorometer: 0,
      currentHorometer: 6700,
      siteId: siteNorte.id,
    },
    {
      internalId: 'ALJ-01',
      plate: 'PX-8812',
      type: 'CAMIÓN ALJIBE',
      brand: 'MERCEDES-BENZ',
      model: 'ACTROS 3344',
      vin: 'MB-ACT-ALJ-01',
      engineNumber: 'OM501LA',
      year: 2019,
      fuelType: 'DIESEL',
      driveType: '6x4',
      ownership: 'ARRENDADO (EXTERNO)',
      maintenanceFrequency: 10000,
      initialHorometer: 0,
      currentHorometer: 45000,
      siteId: siteSur.id,
    },
    {
      internalId: 'GEN-15',
      plate: null,
      type: 'GENERADOR ELÉCTRICO',
      brand: 'VOLVO',
      model: 'TWD1643GE',
      vin: 'V-GEN-15',
      engineNumber: 'VOL-TWD-99',
      year: 2024,
      fuelType: 'DIESEL',
      driveType: 'N/A',
      ownership: 'PROPIO',
      maintenanceFrequency: 250,
      initialHorometer: 0,
      currentHorometer: 450,
      siteId: siteNorte.id,
    },
    {
      internalId: 'GRUA-02',
      plate: 'LL-1250',
      type: 'GRÚA HORQUILLA',
      brand: 'MITSUBISHI',
      model: 'FG25N',
      vin: 'MIT-FG25-02',
      engineNumber: 'K25-001',
      year: 2022,
      fuelType: 'GASOLINA 93',
      driveType: '4x2',
      ownership: 'LEASING',
      maintenanceFrequency: 500,
      initialHorometer: 0,
      currentHorometer: 1200,
      siteId: siteSur.id,
    },
    {
      internalId: 'MINI-05',
      plate: null,
      type: 'MINICARGADOR',
      brand: 'CATERPILLAR',
      model: '262D3',
      vin: 'CAT-262D-05',
      engineNumber: 'C3.3B',
      year: 2023,
      fuelType: 'DIESEL',
      driveType: '4x4',
      ownership: 'PROPIO',
      maintenanceFrequency: 500,
      initialHorometer: 0,
      currentHorometer: 890,
      siteId: siteNorte.id,
    },
    {
      internalId: 'MOTO-01',
      plate: 'LKB-22',
      type: 'MOTONIVELADORA',
      brand: 'LIEBHERR',
      model: 'L 550',
      vin: 'LIE-MOTO-01',
      engineNumber: 'D936-L',
      year: 2021,
      fuelType: 'DIESEL',
      driveType: '6x4',
      ownership: 'PROPIO',
      maintenanceFrequency: 1000,
      initialHorometer: 0,
      currentHorometer: 5400,
      siteId: siteSur.id,
    },
    {
      internalId: 'CARG-04',
      plate: null,
      type: 'CARGADOR FRONTAL',
      brand: 'HYUNDAI',
      model: 'HL960',
      vin: 'HYU-HL960-04',
      engineNumber: 'QSB6.7',
      year: 2022,
      fuelType: 'DIESEL',
      driveType: '4x4',
      ownership: 'LEASING',
      maintenanceFrequency: 500,
      initialHorometer: 0,
      currentHorometer: 2800,
      siteId: siteNorte.id,
    },
  ];

  for (const asset of assets) {
    await prisma.equipment.upsert({
      where: {
        tenantId_internalId: {
          tenantId: tpmTenant.id,
          internalId: asset.internalId,
        },
      },
      update: {},
      create: { ...asset, tenantId: tpmTenant.id },
    });
  }

  console.log('✅ Seed completado con 10 activos y diccionarios completos.');
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
