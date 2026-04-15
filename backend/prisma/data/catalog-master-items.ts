/**
 * Diccionarios de Catálogos Maestros (flota / OT): tipos de equipo, marcas,
 * sistemas, fluidos, combustible, tracción, propiedad.
 * Origen histórico: prisma/seed.ts
 */
import type { CatalogCategory, PrismaClient } from '@prisma/client';

export type CatalogMasterRow = {
  code: string;
  name: string;
  category: CatalogCategory;
};

export const CATALOG_MASTER_ITEMS: CatalogMasterRow[] = [
  // Tipos de equipo
  { code: 'EQT-01', name: 'BULLDOZER', category: 'EQUIPMENT_TYPE' },
  { code: 'EQT-02', name: 'CAMIONETA', category: 'EQUIPMENT_TYPE' },
  { code: 'EQT-03', name: 'CAMIÓN ALJIBE', category: 'EQUIPMENT_TYPE' },
  { code: 'EQT-04', name: 'CAMIÓN TOLVA', category: 'EQUIPMENT_TYPE' },
  { code: 'EQT-05', name: 'CARGADOR FRONTAL', category: 'EQUIPMENT_TYPE' },
  { code: 'EQT-06', name: 'EXCAVADORA', category: 'EQUIPMENT_TYPE' },
  { code: 'EQT-07', name: 'GENERADOR ELÉCTRICO', category: 'EQUIPMENT_TYPE' },
  { code: 'EQT-08', name: 'GRÚA HORQUILLA', category: 'EQUIPMENT_TYPE' },
  { code: 'EQT-09', name: 'MINICARGADOR', category: 'EQUIPMENT_TYPE' },
  { code: 'EQT-10', name: 'MOTONIVELADORA', category: 'EQUIPMENT_TYPE' },

  // Marcas de flota
  { code: 'BRD-01', name: 'CATERPILLAR', category: 'BRAND' },
  { code: 'BRD-02', name: 'FORD', category: 'BRAND' },
  { code: 'BRD-03', name: 'HYUNDAI', category: 'BRAND' },
  { code: 'BRD-04', name: 'KOMATSU', category: 'BRAND' },
  { code: 'BRD-05', name: 'LIEBHERR', category: 'BRAND' },
  { code: 'BRD-06', name: 'MERCEDES-BENZ', category: 'BRAND' },
  { code: 'BRD-07', name: 'MITSUBISHI', category: 'BRAND' },
  { code: 'BRD-08', name: 'SCANIA', category: 'BRAND' },
  { code: 'BRD-09', name: 'TOYOTA', category: 'BRAND' },
  { code: 'BRD-10', name: 'VOLVO', category: 'BRAND' },

  // Tipos de combustible
  { code: 'FUL-00', name: 'N/A', category: 'FUEL_TYPE' },
  { code: 'FUL-01', name: 'DIESEL', category: 'FUEL_TYPE' },
  { code: 'FUL-02', name: 'ELÉCTRICO', category: 'FUEL_TYPE' },
  { code: 'FUL-03', name: 'GASOLINA 93', category: 'FUEL_TYPE' },
  { code: 'FUL-04', name: 'GASOLINA 95', category: 'FUEL_TYPE' },

  // Tipos de tracción
  { code: 'DRV-00', name: 'N/A', category: 'DRIVE_TYPE' },
  { code: 'DRV-01', name: '4x2', category: 'DRIVE_TYPE' },
  { code: 'DRV-02', name: '4x4', category: 'DRIVE_TYPE' },
  { code: 'DRV-03', name: '6x4', category: 'DRIVE_TYPE' },
  { code: 'DRV-04', name: '8x4', category: 'DRIVE_TYPE' },
  { code: 'DRV-05', name: 'ORUGA (CADENAS)', category: 'DRIVE_TYPE' },

  // Tipo de propiedad
  { code: 'OWN-00', name: 'N/A', category: 'OWNERSHIP' },
  { code: 'OWN-01', name: 'ARRENDADO (EXTERNO)', category: 'OWNERSHIP' },
  { code: 'OWN-02', name: 'LEASING', category: 'OWNERSHIP' },
  { code: 'OWN-03', name: 'PROPIO', category: 'OWNERSHIP' },

  // Sistemas intervenidos
  { code: 'SYS-01', name: 'MOTOR', category: 'SYSTEM' },
  { code: 'SYS-02', name: 'TRANSMISIÓN', category: 'SYSTEM' },
  { code: 'SYS-03', name: 'HIDRÁULICO', category: 'SYSTEM' },
  { code: 'SYS-04', name: 'ELÉCTRICO', category: 'SYSTEM' },
  { code: 'SYS-05', name: 'FRENOS', category: 'SYSTEM' },

  // Fluidos y aceites
  { code: 'FLD-01', name: 'ACEITE 15W40', category: 'FLUID' },
  { code: 'FLD-02', name: 'GRASA EP2', category: 'FLUID' },
  { code: 'FLD-03', name: 'REFRIGERANTE ELC', category: 'FLUID' },
];

type CatalogClient = Pick<PrismaClient, 'catalogItem'>;

export async function upsertCatalogMastersForTenant(
  db: CatalogClient,
  tenantId: string,
): Promise<void> {
  for (const item of CATALOG_MASTER_ITEMS) {
    await db.catalogItem.upsert({
      where: { tenantId_code: { tenantId, code: item.code } },
      update: { name: item.name, category: item.category, isActive: true },
      create: {
        tenantId,
        code: item.code,
        name: item.name,
        category: item.category,
      },
    });
  }
}
