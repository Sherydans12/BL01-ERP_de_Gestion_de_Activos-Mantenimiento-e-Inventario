import { PrismaClient } from '@prisma/client';

const DEFAULT_UOMS: ReadonlyArray<{ name: string; abbreviation: string }> = [
  { name: 'Unidades', abbreviation: 'UN' },
  { name: 'Kilogramos', abbreviation: 'KG' },
  { name: 'Litros', abbreviation: 'LT' },
  { name: 'Metros', abbreviation: 'MT' },
];

/**
 * Garantiza las unidades estándar por tenant (idempotente).
 * Llamar al cargar configuración del tenant o tras crear un tenant.
 */
export async function ensureDefaultUnitsOfMeasureForTenant(
  prisma: PrismaClient,
  tenantId: string,
): Promise<void> {
  for (const row of DEFAULT_UOMS) {
    await prisma.unitOfMeasure.upsert({
      where: {
        tenantId_abbreviation: { tenantId, abbreviation: row.abbreviation },
      },
      create: {
        tenantId,
        name: row.name,
        abbreviation: row.abbreviation,
      },
      update: {},
    });
  }
}
