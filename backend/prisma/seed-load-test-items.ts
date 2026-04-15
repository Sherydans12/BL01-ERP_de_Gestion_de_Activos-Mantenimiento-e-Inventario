/**
 * Inyección masiva de artículos ficticios para prueba de carga / índices.
 *
 * Uso (desde backend/):
 *   set LOAD_TEST_TENANT_ID=<uuid-del-tenant>
 *   npx ts-node prisma/seed-load-test-items.ts
 *
 * Crea 10.000 InventoryItem con part numbers LOAD-0000001 … repartidos
 * entre las subcategorías existentes del tenant.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';

const TOTAL = 10_000;
const BATCH = 250;

async function main() {
  const tenantId = process.env.LOAD_TEST_TENANT_ID?.trim();
  if (!tenantId) {
    throw new Error('Defina LOAD_TEST_TENANT_ID con el UUID del tenant.');
  }

  const prisma = new PrismaClient();
  try {
    const leaves = await prisma.itemCategory.findMany({
      where: { tenantId, parentCategoryId: { not: null } },
      select: { id: true },
    });
    if (leaves.length === 0) {
      throw new Error(
        'No hay subcategorías (hojas). Cree jerarquía en Configuración de categorías.',
      );
    }

    const uom = await prisma.unitOfMeasure.findFirst({
      where: { tenantId },
      select: { id: true },
    });
    if (!uom) {
      throw new Error('No hay unidad de medida para el tenant.');
    }

    let inserted = 0;
    for (let i = 0; i < TOTAL; i += BATCH) {
      const chunk: {
        id: string;
        qrCode: string;
        tenantId: string;
        partNumber: string;
        name: string;
        categoryId: string;
        unitOfMeasureId: string;
      }[] = [];

      for (let j = 0; j < BATCH && i + j < TOTAL; j++) {
        const idx = i + j;
        const id = randomUUID();
        const leaf = leaves[idx % leaves.length];
        chunk.push({
          id,
          qrCode: `INV:${id}`,
          tenantId,
          partNumber: `LOAD-${String(idx + 1).padStart(7, '0')}`,
          name: `Artículo prueba carga ${idx + 1}`,
          categoryId: leaf.id,
          unitOfMeasureId: uom.id,
        });
      }

      await prisma.inventoryItem.createMany({ data: chunk });
      inserted += chunk.length;
      console.log(`Insertados ${inserted} / ${TOTAL}`);
    }

    console.log('Listo.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
