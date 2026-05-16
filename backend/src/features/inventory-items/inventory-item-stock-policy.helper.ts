import { Prisma } from '@prisma/client';

/**
 * Umbrales guardados en el maestro del artículo para la primera fila `item_stocks`
 * en la bodega indicada (sin crear fila hasta el primer movimiento).
 */
export async function getPolicyThresholdsForNewItemStockRow(
  tx: Prisma.TransactionClient,
  tenantId: string,
  itemId: string,
  warehouseId: string,
): Promise<{ minStock: number; maxStock: number }> {
  const item = await tx.inventoryItem.findFirst({
    where: { id: itemId, tenantId },
    select: {
      policyTargetWarehouseId: true,
      policyMinStock: true,
      policyMaxStock: true,
    },
  });
  if (
    !item?.policyTargetWarehouseId ||
    item.policyTargetWarehouseId !== warehouseId
  ) {
    return { minStock: 0, maxStock: 0 };
  }
  return {
    minStock: Number(item.policyMinStock ?? 0),
    maxStock: Number(item.policyMaxStock ?? 0),
  };
}

/** Limpia la política pendiente si apuntaba a esta bodega (tras crear/actualizar posición). */
export async function clearItemStockPolicyIfMatchesWarehouse(
  tx: Prisma.TransactionClient,
  tenantId: string,
  itemId: string,
  warehouseId: string,
): Promise<void> {
  await tx.inventoryItem.updateMany({
    where: {
      id: itemId,
      tenantId,
      policyTargetWarehouseId: warehouseId,
    },
    data: {
      policyTargetWarehouseId: null,
      policyMinStock: null,
      policyMaxStock: null,
    },
  });
}
