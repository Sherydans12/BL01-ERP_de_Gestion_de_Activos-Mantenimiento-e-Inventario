import type { PrismaClient } from '@prisma/client';
import {
  FIELD_DISPATCH_REFERENCE_TYPE,
  FIELD_RETURN_REFERENCE_TYPE,
} from './field-dispatch.constants';

export async function getFieldDispatchOutstandingForItem(
  prisma: Pick<PrismaClient, 'inventoryTransaction'>,
  tenantId: string,
  warehouseId: string,
  itemId: string,
): Promise<number> {
  const [outAgg, inAgg] = await Promise.all([
    prisma.inventoryTransaction.aggregate({
      where: {
        warehouseId,
        itemId,
        type: 'OUT',
        referenceType: FIELD_DISPATCH_REFERENCE_TYPE,
        warehouse: { tenantId },
      },
      _sum: { quantity: true },
    }),
    prisma.inventoryTransaction.aggregate({
      where: {
        warehouseId,
        itemId,
        type: 'IN',
        referenceType: FIELD_RETURN_REFERENCE_TYPE,
        warehouse: { tenantId },
      },
      _sum: { quantity: true },
    }),
  ]);
  return (
    Number(outAgg._sum.quantity ?? 0) - Number(inAgg._sum.quantity ?? 0)
  );
}

/** Ítems con saldo neto pendiente de reingreso (salidas FIELD_DISPATCH − reingresos FIELD_RETURN). */
export async function listItemIdsWithFieldDispatchOutstanding(
  prisma: Pick<PrismaClient, 'inventoryTransaction'>,
  tenantId: string,
  warehouseId: string,
): Promise<string[]> {
  const [outs, ins] = await Promise.all([
    prisma.inventoryTransaction.groupBy({
      by: ['itemId'],
      where: {
        warehouseId,
        type: 'OUT',
        referenceType: FIELD_DISPATCH_REFERENCE_TYPE,
        warehouse: { tenantId },
      },
      _sum: { quantity: true },
    }),
    prisma.inventoryTransaction.groupBy({
      by: ['itemId'],
      where: {
        warehouseId,
        type: 'IN',
        referenceType: FIELD_RETURN_REFERENCE_TYPE,
        warehouse: { tenantId },
      },
      _sum: { quantity: true },
    }),
  ]);
  const inMap = new Map(
    ins.map((r) => [r.itemId, Number(r._sum.quantity ?? 0)]),
  );
  const ids: string[] = [];
  for (const o of outs) {
    const outQ = Number(o._sum.quantity ?? 0);
    const inQ = inMap.get(o.itemId) ?? 0;
    if (outQ - inQ > 1e-9) {
      ids.push(o.itemId);
    }
  }
  return ids;
}
