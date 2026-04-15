import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  const tenantId = process.env.LOAD_TEST_TENANT_ID?.trim() || null;
  const whereByTenant = tenantId ? { tenantId } : {};

  try {
    const loadItems = await prisma.inventoryItem.findMany({
      where: {
        ...whereByTenant,
        partNumber: { startsWith: 'LOAD-' },
      },
      select: { id: true },
      take: 20_000,
    });

    if (!loadItems.length) {
      console.log('No hay ítems de prueba con prefijo LOAD-.');
      return;
    }

    const itemIds = loadItems.map((i) => i.id);
    console.log(`Encontrados ${itemIds.length} ítems de prueba LOAD-.`);

    const deletedAttachments = await prisma.inventoryItemAttachment.deleteMany({
      where: { itemId: { in: itemIds } },
    });
    const deletedStocks = await prisma.itemStock.deleteMany({
      where: { itemId: { in: itemIds } },
    });
    const deletedTransactions = await prisma.inventoryTransaction.deleteMany({
      where: { itemId: { in: itemIds } },
    });
    const deletedTransferLines = await prisma.inventoryTransferLine.deleteMany({
      where: { itemId: { in: itemIds } },
    });
    const deletedItems = await prisma.inventoryItem.deleteMany({
      where: { id: { in: itemIds } },
    });

    console.log(`Adjuntos eliminados: ${deletedAttachments.count}`);
    console.log(`Stocks eliminados: ${deletedStocks.count}`);
    console.log(`Transacciones eliminadas: ${deletedTransactions.count}`);
    console.log(`Líneas de transferencia eliminadas: ${deletedTransferLines.count}`);
    console.log(`Ítems eliminados: ${deletedItems.count}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
