import type { PrismaClient } from '@prisma/client';
import { buildRequisitionReconciliationSnapshot } from './purchase-requisition-reconciliation.util';
import { buildActivityLogDetails } from '../../common/audit/activity-log-details.util';

/** Resuelve el SRC desde una OC (directo o vía cotización multiproveedor). */
export function requisitionIdFromPurchaseOrder(po: {
  requisitionId?: string | null;
  quotation?: { requisitionId: string } | null;
} | null): string | null {
  if (!po) return null;
  return po.requisitionId ?? po.quotation?.requisitionId ?? null;
}

const AUTO_CLOSE_MESSAGE =
  'Cierre automático por conciliación total (Recepción + Facturación)';

/**
 * Si el snapshot confirma cierre contable completo en líneas adjudicadas,
 * pasa el requerimiento a CLOSED y deja trazabilidad en ActivityLog.
 *
 * @param actorUserId Usuario que disparó la recepción o la validación de factura (no es «quien cerró a mano»).
 */
export async function tryAutoCloseRequisitionIfFullyReconciled(
  prisma: PrismaClient,
  tenantId: string,
  requisitionId: string | null | undefined,
  actorUserId: string | null | undefined,
): Promise<boolean> {
  const rid = requisitionId?.trim();
  if (!rid) return false;
  const uid = actorUserId?.trim();
  if (!uid) return false;

  const req = await prisma.purchaseRequisition.findFirst({
    where: { id: rid, tenantId },
    select: {
      id: true,
      correlative: true,
      status: true,
      items: {
        select: {
          id: true,
          quantity: true,
          awardedQuotationItemId: true,
        },
      },
    },
  });
  if (!req) return false;
  if (['CLOSED', 'REJECTED', 'CANCELLED', 'DRAFT'].includes(req.status)) {
    return false;
  }

  const items = req.items.map((i) => ({
    id: i.id,
    quantity: Number(i.quantity),
    awardedQuotationItemId: i.awardedQuotationItemId,
  }));

  const snapshot = await buildRequisitionReconciliationSnapshot(
    prisma,
    tenantId,
    req.id,
    items,
  );

  if (!snapshot.allAdjudicatedLinesFullyReconciled) {
    return false;
  }

  const prevStatus = req.status;

  await prisma.$transaction(async (tx) => {
    await tx.purchaseRequisition.update({
      where: { id: req.id },
      data: { status: 'CLOSED' },
    });

    await tx.activityLog.create({
      data: {
        tenantId,
        userId: uid,
        entityType: 'REQUISITION',
        entityId: req.id,
        action: 'STATUS_CHANGE',
        details: buildActivityLogDetails(
          { status: prevStatus },
          {
            status: 'CLOSED',
            message: AUTO_CLOSE_MESSAGE,
            correlative: req.correlative,
          },
          {
            field: 'status',
            prev: prevStatus,
            next: 'CLOSED',
            metadata: {
              event: 'requisition_auto_closed_full_reconciliation',
              message: AUTO_CLOSE_MESSAGE,
            },
          },
        ),
      },
    });
  });

  return true;
}
