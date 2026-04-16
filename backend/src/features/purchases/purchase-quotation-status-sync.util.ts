import type { Prisma, QuotationStatus } from '@prisma/client';

export type QuotationStatusChange = {
  quotationId: string;
  vendorName: string | null;
  previousStatus: QuotationStatus;
  nextStatus: QuotationStatus;
};

/**
 * Alinea `PurchaseQuotation.status` / `isWinner` con `RequisitionItem.awardedQuotationItemId`
 * (adjudicación multiproveedor por ítem).
 *
 * Si aún no hay ninguna línea adjudicada, no hace nada (preserva flujo legado «ganadora única»).
 */
export async function syncPurchaseQuotationStatusesFromLineAwards(
  tx: Prisma.TransactionClient,
  requisitionId: string,
): Promise<QuotationStatusChange[]> {
  const reqItems = await tx.requisitionItem.findMany({
    where: { requisitionId },
    select: { awardedQuotationItemId: true },
  });
  if (!reqItems.length) return [];
  const anyAward = reqItems.some((i) => i.awardedQuotationItemId != null);
  if (!anyAward) return [];

  const quotations = await tx.purchaseQuotation.findMany({
    where: { requisitionId },
    select: {
      id: true,
      status: true,
      vendor: { select: { name: true } },
      items: { select: { id: true } },
    },
  });

  const awardSet = new Set(
    reqItems
      .map((i) => i.awardedQuotationItemId)
      .filter((id): id is string => id != null),
  );
  const allReqLinesHaveAward = reqItems.every(
    (i) => i.awardedQuotationItemId != null,
  );

  const changes: QuotationStatusChange[] = [];

  for (const q of quotations) {
    const lineIds = q.items.map((i) => i.id);
    const lineCount = lineIds.length;
    if (lineCount === 0) continue;

    let awardedFromThis = 0;
    for (const lid of lineIds) {
      if (awardSet.has(lid)) awardedFromThis++;
    }

    let nextStatus: QuotationStatus;
    if (awardedFromThis === lineCount) {
      nextStatus = 'SELECTED';
    } else if (awardedFromThis > 0) {
      nextStatus = 'PARTIALLY_SELECTED';
    } else if (allReqLinesHaveAward) {
      nextStatus = 'REJECTED';
    } else {
      nextStatus = 'RECEIVED';
    }

    const isWinner = nextStatus === 'SELECTED';
    const previousStatus = q.status;

    if (previousStatus !== nextStatus) {
      changes.push({
        quotationId: q.id,
        vendorName: q.vendor?.name ?? null,
        previousStatus,
        nextStatus,
      });
    }

    await tx.purchaseQuotation.update({
      where: { id: q.id },
      data: { status: nextStatus, isWinner },
    });
  }

  return changes;
}
