import type { PrismaClient } from '@prisma/client';

export type RequisitionReconciliationSnapshot = {
  totalRequisitionLines: number;
  linesInProcurement: number;
  linesFullyReceived: number;
  linesWithInvoice: number;
  adjudicatedMatrixTotal: number;
  invoicesTotal: number;
  currency: string | null;
  budgetExceeded: boolean;
};

const PO_INACTIVE = ['CANCELLED', 'REJECTED'] as const;

/**
 * Avance 3-way agregado por requerimiento (varias OC / proveedores).
 */
export async function buildRequisitionReconciliationSnapshot(
  prisma: PrismaClient,
  tenantId: string,
  requisitionId: string,
  items: Array<{
    id: string;
    quantity: number;
    awardedQuotationItemId: string | null;
  }>,
): Promise<RequisitionReconciliationSnapshot> {
  const totalRequisitionLines = items.length;
  const awardIds = items
    .map((i) => i.awardedQuotationItemId)
    .filter((id): id is string => id != null);

  let adjudicatedMatrixTotal = 0;
  let currency: string | null = null;

  if (awardIds.length) {
    const qis = await prisma.quotationItem.findMany({
      where: { id: { in: awardIds } },
      include: {
        requisitionItem: { select: { quantity: true } },
        quotation: { select: { currency: true } },
      },
    });
    for (const qi of qis) {
      const qty = Number(qi.requisitionItem.quantity);
      adjudicatedMatrixTotal += Number(qi.unitPrice) * qty;
      if (!currency) currency = qi.quotation.currency ?? null;
    }
  }

  const pos = await prisma.purchaseOrder.findMany({
    where: {
      tenantId,
      requisitionId,
      status: { notIn: [...PO_INACTIVE] },
    },
    select: {
      id: true,
      currency: true,
      items: {
        select: {
          id: true,
          quantity: true,
          sourceQuotationItemId: true,
        },
      },
      purchaseInvoice: {
        select: { id: true, totalAmount: true },
      },
      receipts: {
        select: {
          items: {
            select: {
              orderItemId: true,
              quantityReceived: true,
            },
          },
        },
      },
    },
  });

  const reqLineBySource = new Map<string, string>();
  for (const it of items) {
    if (it.awardedQuotationItemId) {
      reqLineBySource.set(it.awardedQuotationItemId, it.id);
    }
  }

  const procurementReqLines = new Set<string>();
  const receivedReqLines = new Set<string>();
  const invoicedReqLines = new Set<string>();

  let invoicesTotal = 0;

  for (const po of pos) {
    if (!currency && po.currency) currency = po.currency;
    if (po.purchaseInvoice) {
      invoicesTotal += Number(po.purchaseInvoice.totalAmount);
    }

    const receivedByOrderItem = new Map<string, number>();
    for (const r of po.receipts) {
      for (const ri of r.items) {
        const prev = receivedByOrderItem.get(ri.orderItemId) ?? 0;
        receivedByOrderItem.set(
          ri.orderItemId,
          prev + Number(ri.quantityReceived),
        );
      }
    }

    for (const pol of po.items) {
      const src = pol.sourceQuotationItemId;
      if (!src) continue;
      const reqLineId = reqLineBySource.get(src);
      if (!reqLineId) continue;
      procurementReqLines.add(reqLineId);

      const ordered = Number(pol.quantity);
      const got = receivedByOrderItem.get(pol.id) ?? 0;
      if (got + 1e-6 >= ordered) {
        receivedReqLines.add(reqLineId);
      }

      if (po.purchaseInvoice) {
        invoicedReqLines.add(reqLineId);
      }
    }
  }

  const linesInProcurement = procurementReqLines.size;
  const linesFullyReceived = [...receivedReqLines].filter((id) =>
    procurementReqLines.has(id),
  ).length;
  const linesWithInvoice = [...invoicedReqLines].filter((id) =>
    procurementReqLines.has(id),
  ).length;

  const budgetExceeded =
    adjudicatedMatrixTotal > 0 &&
    invoicesTotal > adjudicatedMatrixTotal + 0.01;

  return {
    totalRequisitionLines,
    linesInProcurement,
    linesFullyReceived,
    linesWithInvoice,
    adjudicatedMatrixTotal,
    invoicesTotal,
    currency,
    budgetExceeded,
  };
}
