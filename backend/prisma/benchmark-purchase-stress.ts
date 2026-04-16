/**
 * Stress / benchmark: adjudicación split → createOrdersFromRequisition + tiempo de reconciliationSnapshot.
 *
 * Uso (con DB migrada y un SRC en estado válido con líneas adjudicadas pendientes de OC):
 *   npx ts-node prisma/benchmark-purchase-stress.ts <requisitionId>
 *
 * Salida JSON: ms de createOrdersFromReconciliation, ms de buildRequisitionReconciliationSnapshot, órdenes creadas.
 * Ejecutar contra un entorno de prueba: en producción puede crear OCs reales.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PurchaseOrdersService } from '../src/features/purchases/purchase-orders.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { buildRequisitionReconciliationSnapshot } from '../src/features/purchases/purchase-requisition-reconciliation.util';

async function main() {
  const reqId = process.argv[2]?.trim();
  if (!reqId) {
    console.error(
      'Uso: npx ts-node prisma/benchmark-purchase-stress.ts <requisitionId>',
    );
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const orders = app.get(PurchaseOrdersService);
  const prisma = app.get(PrismaService);

  const user = await prisma.user.findFirst({
    where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] } },
    select: { id: true, tenantId: true, role: true },
  });
  if (!user) {
    console.error('No hay usuario ADMIN/SUPER_ADMIN para el benchmark.');
    await app.close();
    process.exit(1);
  }

  const tenantId = user.tenantId;
  if (!tenantId) {
    console.error('Usuario sin tenantId.');
    await app.close();
    process.exit(1);
  }

  const u = { id: user.id, tenantId, role: user.role };

  const tSplit0 = performance.now();
  const split = await orders.createOrdersFromRequisition(reqId, u);
  const tSplit1 = performance.now();

  const reqRow = await prisma.purchaseRequisition.findFirst({
    where: { id: reqId, tenantId },
    include: {
      items: {
        select: { id: true, quantity: true, awardedQuotationItemId: true },
      },
    },
  });

  let reconciliationSnapshotMs = 0;
  if (reqRow) {
    const items = reqRow.items.map((i) => ({
      id: i.id,
      quantity: Number(i.quantity),
      awardedQuotationItemId: i.awardedQuotationItemId,
    }));
    const tr0 = performance.now();
    await buildRequisitionReconciliationSnapshot(prisma, tenantId, reqId, items);
    const tr1 = performance.now();
    reconciliationSnapshotMs = tr1 - tr0;
  }

  console.log(
    JSON.stringify(
      {
        requisitionId: reqId,
        createOrdersFromRequisitionMs: Math.round(tSplit1 - tSplit0),
        ordersCreated: split.orders.length,
        requisitionStatusAfter: split.requisitionStatus,
        idempotent: split.idempotent,
        reconciliationSnapshotMs: Math.round(reconciliationSnapshotMs),
      },
      null,
      2,
    ),
  );

  await app.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
