import 'dotenv/config';
import {
  PrismaClient,
  CatalogCategory,
  UserRole,
  MeterType,
} from '@prisma/client';
import { ensureDefaultTenantRolesForTenant } from '../src/features/tenant-roles/tenant-role-defaults';
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

  await ensureDefaultTenantRolesForTenant(prisma, tpmTenant.id);

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

  // 3. CONTRATOS Y SUBCONTRATOS
  console.log('🏗️ Creando Contratos y Subcontratos...');
  const contractCaserones = await prisma.contract.upsert({
    where: { tenantId_code: { tenantId: tpmTenant.id, code: 'CTR-CASERONES' } },
    update: {},
    create: {
      tenantId: tpmTenant.id,
      code: 'CTR-CASERONES',
      name: 'Faena Caserones',
      subcontracts: {
        create: [
          { code: '448', name: 'Movimiento de Tierra 448' },
          { code: '448-16', name: 'Mantenimiento Vial 448-16' },
        ],
      },
    },
    include: { subcontracts: true },
  });

  const contractCoronel = await prisma.contract.upsert({
    where: { tenantId_code: { tenantId: tpmTenant.id, code: 'CTR-CORONEL' } },
    update: {},
    create: {
      tenantId: tpmTenant.id,
      code: 'CTR-CORONEL',
      name: 'Puerto Coronel',
      subcontracts: {
        create: [{ code: 'LOG-01', name: 'Logística Interna' }],
      },
    },
    include: { subcontracts: true },
  });

  // 3.5. KITS DE MANTENIMIENTO (PM KITS)
  console.log('📦 Creando Kits de Mantenimiento (PM)...');

  await prisma.maintenanceKit.upsert({
    where: { tenantId_code: { tenantId: tpmTenant.id, code: 'KIT-PM-250' } },
    update: {},
    create: {
      tenantId: tpmTenant.id,
      contractId: contractCaserones.id, // <--- CORRECCIÓN: Contrato Obligatorio
      code: 'KIT-PM-250',
      name: 'Mantención Preventiva 250 Hrs',
      description:
        'Inspección general, lubricación y cambio de filtros básicos.',
      equipmentBrand: 'CATERPILLAR', // <--- Aprovechamos de probar los filtros
      equipmentModel: '320 NEXT GEN',
      parts: {
        create: [
          {
            partNumber: '577-1440',
            description: 'FILTRO ACEITE MOTOR',
            quantity: 1,
          },
          {
            partNumber: '545-8339',
            description: 'FILTRO COMBUSTIBLE',
            quantity: 2,
          },
          {
            partNumber: '111-5718',
            description: 'FILTRO SEPARADOR AGUA',
            quantity: 1,
          },
        ],
      },
    },
  });

  await prisma.maintenanceKit.upsert({
    where: { tenantId_code: { tenantId: tpmTenant.id, code: 'KIT-PM-500' } },
    update: {},
    create: {
      tenantId: tpmTenant.id,
      contractId: contractCoronel.id, // <--- CORRECCIÓN: Contrato Obligatorio
      code: 'KIT-PM-500',
      name: 'Mantención Preventiva 500 Hrs',
      description:
        'PM 250 + Cambio de aceite de transmisión y filtros de aire.',
      equipmentBrand: 'SCANIA',
      equipmentModel: 'G440',
      parts: {
        create: [
          {
            partNumber: '577-1440',
            description: 'FILTRO ACEITE MOTOR',
            quantity: 1,
          },
          {
            partNumber: '545-8339',
            description: 'FILTRO COMBUSTIBLE',
            quantity: 2,
          },
          {
            partNumber: '111-5718',
            description: 'FILTRO SEPARADOR AGUA',
            quantity: 1,
          },
          {
            partNumber: '299-8229',
            description: 'FILTRO AIRE PRIMARIO',
            quantity: 1,
          },
          {
            partNumber: '299-8230',
            description: 'FILTRO AIRE SECUNDARIO',
            quantity: 1,
          },
          {
            partNumber: '322-3155',
            description: 'FILTRO TRANSMISIÓN',
            quantity: 1,
          },
        ],
      },
    },
  });

  // 4. USUARIOS
  const hashedPassword = await bcrypt.hash('admin123', 10);
  await prisma.user.upsert({
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
      // Dar acceso a ambos contratos
      contractAccess: {
        create: [
          { contractId: contractCaserones.id },
          { contractId: contractCoronel.id },
        ],
      },
    },
  });

  // 5. FLOTA DE EQUIPOS EVOLUCIONADA
  console.log('🚜 Creando flota diversificada...');

  // Extraemos IDs de subcontratos para usarlos
  const subCaserones448 = contractCaserones.subcontracts.find(
    (s) => s.code === '448',
  )!.id;
  const subCaserones448_16 = contractCaserones.subcontracts.find(
    (s) => s.code === '448-16',
  )!.id;
  const subCoronel = contractCoronel.subcontracts[0].id;

  const assets = [
    {
      internalId: 'CAM-001',
      mineInternalId: 'CM-01-CAS',
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
      meterType: MeterType.KILOMETERS,
      initialMeter: 0,
      currentMeter: 15400,
      lastMaintenanceDate: new Date('2025-10-01'),
      lastMaintenanceMeter: 10000,
      lastMaintenanceType: 'Mantenimiento Preventivo 10K',
      techReviewExp: new Date('2026-10-15'),
      circPermitExp: new Date('2026-03-31'),
      soapExp: new Date('2026-03-31'),
      mechanicalCertExp: new Date('2026-10-15'),
      liabilityPolicyExp: new Date('2026-10-15'),
      subcontractId: subCaserones448_16,
    },
    {
      internalId: 'EXC-055',
      mineInternalId: 'EX-99',
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
      meterType: MeterType.HOURS,
      initialMeter: 0,
      currentMeter: 3210,
      lastMaintenanceDate: new Date('2026-02-15'),
      lastMaintenanceMeter: 3000,
      lastMaintenanceType: 'PM3 - 1000H',
      techReviewExp: new Date('2027-02-15'), // Agregado para cumplir campos opcionales
      circPermitExp: new Date('2027-02-15'),
      soapExp: new Date('2027-02-15'),
      mechanicalCertExp: new Date('2027-02-15'),
      liabilityPolicyExp: new Date('2027-02-15'),
      subcontractId: subCaserones448,
    },
    {
      internalId: 'TOL-010',
      mineInternalId: 'CT-10-COR',
      plate: 'KKB-992',
      type: 'CAMIÓN TOLVA',
      brand: 'SCANIA',
      model: 'G440',
      vin: 'SCA440-998877',
      engineNumber: 'DC13-112',
      year: 2021,
      fuelType: 'DIESEL',
      driveType: '6x4',
      ownership: 'PROPIO',
      maintenanceFrequency: 20000,
      meterType: MeterType.KILOMETERS,
      initialMeter: 0,
      currentMeter: 85000,
      lastMaintenanceDate: new Date('2025-11-20'),
      lastMaintenanceMeter: 80000,
      lastMaintenanceType: 'Mantenimiento Preventivo 80K',
      techReviewExp: new Date('2026-08-20'),
      circPermitExp: new Date('2026-03-31'),
      soapExp: new Date('2026-03-31'),
      mechanicalCertExp: new Date('2026-08-20'),
      liabilityPolicyExp: new Date('2026-08-20'),
      subcontractId: subCoronel,
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

  console.log('✅ Seed completado con éxito.');
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
