import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SequenceService } from '../../common/sequence/sequence.service';
import { StorageService } from '../../common/storage/storage.service';
import { AuditService, pickChanged } from '../../common/audit/audit.service';
import type { Prisma } from '@prisma/client';
import { RequisitionStatus } from '@prisma/client';
import {
  EQUIPMENT_LINK_SELECT,
  WORK_ORDER_LINK_SELECT,
} from './purchase-asset-links.include';
import { assertUserHasContractAccess } from './purchase-contract-access.util';
import { SaveLineAwardsDto } from './dto/line-awards.dto';
import {
  syncPurchaseQuotationStatusesFromLineAwards,
  type QuotationStatusChange,
} from './purchase-quotation-status-sync.util';
import { buildRequisitionReconciliationSnapshot } from './purchase-requisition-reconciliation.util';

const PO_INACTIVE_FOR_LINK = ['CANCELLED', 'REJECTED'] as const;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string | undefined | null): boolean {
  return typeof value === 'string' && UUID_RE.test(value);
}

type RequisitionItemCatalogInput = {
  inventoryItemId?: string | null;
};

const SUBCONTRACT_SELECT = {
  select: { id: true, code: true, name: true },
} as const;

/** Include ligero para listados y detalle (equipo / OT vinculados al requerimiento). */
function equipmentDisplayName(
  e: {
    internalId: string;
    plate?: string | null;
    brand: string;
    model: string;
  } | null,
): string | null {
  if (!e) return null;
  const label = [e.brand, e.model].filter(Boolean).join(' ').trim();
  return label || e.internalId || e.plate || null;
}

function workOrderDisplayName(
  wo: { correlative: string; description: string } | null,
): string | null {
  if (!wo) return null;
  const short =
    wo.description.length > 80
      ? `${wo.description.slice(0, 77)}...`
      : wo.description;
  return `${wo.correlative}${short ? ` — ${short}` : ''}`;
}

/** Serialización estable de ítems para auditoría (diff en detalle de OC vía requerimiento vinculado). */
function requisitionItemsSnapshot(
  items: Array<{
    id: string;
    description: string;
    quantity: unknown;
    unitOfMeasure: string;
    estimatedCost: unknown;
    inventoryItemId?: string | null;
    partNumber?: string | null;
    itemNotes?: string | null;
  }>,
) {
  return [...items]
    .map((i) => ({
      id: i.id,
      description: i.description,
      quantity: Number(i.quantity),
      unitOfMeasure: i.unitOfMeasure,
      estimatedCost:
        i.estimatedCost != null
          ? Number(i.estimatedCost as number | string)
          : null,
      inventoryItemId: i.inventoryItemId ?? null,
      partNumber: i.partNumber ?? null,
      itemNotes: i.itemNotes ?? null,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

@Injectable()
export class PurchaseRequisitionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sequenceService: SequenceService,
    private readonly storageService: StorageService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Cada línea debe referenciar un `inventory_items` del mismo tenant (catálogo maestro).
   */
  private async ensureRequisitionItemsCatalogLinked(
    tenantId: string,
    items: RequisitionItemCatalogInput[],
  ) {
    if (!Array.isArray(items) || items.length === 0) {
      throw new BadRequestException(
        'El requerimiento debe tener al menos un ítem',
      );
    }
    for (let i = 0; i < items.length; i++) {
      const raw = items[i].inventoryItemId;
      const id =
        raw === null || raw === undefined ? '' : String(raw).trim();
      if (!id || !isUuid(id)) {
        throw new BadRequestException(
          'Cada línea del requerimiento debe estar vinculada a un artículo del catálogo maestro (seleccione un ítem existente o cree uno nuevo).',
        );
      }
    }
    const uniqueIds = [
      ...new Set(
        items.map((it) => String(it.inventoryItemId).trim()),
      ),
    ];
    const found = await this.prisma.inventoryItem.findMany({
      where: { tenantId, id: { in: uniqueIds } },
      select: { id: true },
    });
    if (found.length !== uniqueIds.length) {
      throw new BadRequestException(
        'Uno o más artículos del catálogo no existen o no pertenecen a su organización',
      );
    }
  }

  /** Cantidad solicitada por línea: fluye a OC y recepción (esperado en bodega). */
  private assertRequisitionLineQuantities(
    items: Array<{ quantity?: unknown }>,
  ) {
    for (let i = 0; i < items.length; i++) {
      const q = Number(items[i].quantity);
      if (!Number.isFinite(q) || q <= 0) {
        throw new BadRequestException(
          `Línea ${i + 1}: la cantidad solicitada debe ser un número mayor a cero.`,
        );
      }
    }
  }

  private assertEquipmentBelongsToContract(
    equipment: {
      contractId: string | null;
      subcontractId: string | null;
      subcontract: { contractId: string } | null;
    },
    contractId: string,
  ) {
    const direct = equipment.contractId === contractId;
    const viaSubcontract =
      !!equipment.subcontractId &&
      equipment.subcontract?.contractId === contractId;
    if (!direct && !viaSubcontract) {
      throw new BadRequestException(
        'El equipo no pertenece al contrato del requerimiento',
      );
    }
  }

  /**
   * Si el requerimiento tiene subcontrato, el equipo no debe estar asignado a otro subcontrato distinto.
   * Equipo solo a nivel contrato (sin subcontrato) sigue siendo válido si pertenece al contrato.
   */
  private assertEquipmentAlignedWithRequisitionSubcontract(
    equipment: { contractId: string | null; subcontractId: string | null },
    requisitionSubcontractId: string | null,
  ) {
    if (!requisitionSubcontractId) {
      return;
    }
    if (equipment.subcontractId != null) {
      if (equipment.subcontractId !== requisitionSubcontractId) {
        throw new BadRequestException(
          'El equipo no está asignado al mismo subcontrato que el requerimiento',
        );
      }
    }
  }

  /**
   * Resuelve vínculos OT/equipo: si hay OT, el equipo es el de la OT.
   * Valida coherencia si se envían ambos identificadores.
   */
  private async resolveRequisitionAssetLinks(
    db: Prisma.TransactionClient | PrismaService,
    tenantId: string,
    contractId: string,
    requisitionSubcontractId: string | null,
    workOrderId: string | null,
    equipmentId: string | null,
  ): Promise<{ equipmentId: string | null; workOrderId: string | null }> {
    if (workOrderId) {
      if (!isUuid(workOrderId)) {
        throw new BadRequestException('ID de orden de trabajo inválido');
      }
      const wo = await db.workOrder.findFirst({
        where: { id: workOrderId, tenantId },
        include: {
          equipment: {
            include: { subcontract: { select: { contractId: true } } },
          },
        },
      });
      if (!wo) {
        throw new BadRequestException(
          'La orden de trabajo no existe o no pertenece a su organización',
        );
      }
      this.assertEquipmentBelongsToContract(wo.equipment, contractId);
      this.assertEquipmentAlignedWithRequisitionSubcontract(
        wo.equipment,
        requisitionSubcontractId,
      );
      if (equipmentId !== null && equipmentId !== wo.equipmentId) {
        throw new BadRequestException(
          'El equipo indicado no corresponde al equipo de la orden de trabajo seleccionada',
        );
      }
      return { equipmentId: wo.equipmentId, workOrderId: wo.id };
    }

    if (equipmentId) {
      if (!isUuid(equipmentId)) {
        throw new BadRequestException('ID de equipo inválido');
      }
      const eq = await db.equipment.findFirst({
        where: { id: equipmentId, tenantId },
        include: { subcontract: { select: { contractId: true } } },
      });
      if (!eq) {
        throw new BadRequestException(
          'El equipo no existe o no pertenece a su organización',
        );
      }
      this.assertEquipmentBelongsToContract(eq, contractId);
      this.assertEquipmentAlignedWithRequisitionSubcontract(
        eq,
        requisitionSubcontractId,
      );
      return { equipmentId: eq.id, workOrderId: null };
    }

    return { equipmentId: null, workOrderId: null };
  }

  private buildContractScope(
    user?: { role?: string; allowedContracts?: string[] },
    contractId?: string,
  ): { contractId?: string | { in: string[] } } {
    if (contractId && contractId !== 'ALL') return { contractId };
    if (!user) return {};
    if (user.role === 'ADMIN' || user.role === 'SUPER_ADMIN') return {};
    const allowed = user.allowedContracts ?? [];
    if (allowed.includes('ALL')) return {};
    if (!allowed.length) {
      return { contractId: '00000000-0000-4000-8000-000000000000' };
    }
    return { contractId: { in: allowed } };
  }

  async findAll(
    tenantId: string,
    contractId?: string,
    status?: string,
    user?: { role?: string; allowedContracts?: string[] },
  ) {
    const contractFilter = this.buildContractScope(user, contractId);
    return this.prisma.purchaseRequisition.findMany({
      where: {
        tenantId,
        ...contractFilter,
        ...(status && { status: status as RequisitionStatus }),
      },
      include: {
        requestedBy: { select: { id: true, name: true, email: true } },
        contract: { select: { id: true, code: true, name: true } },
        subcontract: SUBCONTRACT_SELECT,
        equipment: EQUIPMENT_LINK_SELECT,
        workOrder: WORK_ORDER_LINK_SELECT,
        _count: { select: { items: true, quotations: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(
    id: string,
    tenantId: string,
    user?: { role?: string; allowedContracts?: string[] },
  ) {
    const [requisition, purchaseDocuments] = await Promise.all([
      this.prisma.purchaseRequisition.findFirst({
        where: { id, tenantId },
        include: {
          requestedBy: { select: { id: true, name: true, email: true } },
          contract: { select: { id: true, code: true, name: true } },
          subcontract: SUBCONTRACT_SELECT,
          equipment: EQUIPMENT_LINK_SELECT,
          workOrder: WORK_ORDER_LINK_SELECT,
          items: {
            include: {
              inventoryItem: {
                select: { id: true, partNumber: true, name: true },
              },
              awardedQuotationItem: {
                include: {
                  quotation: {
                    select: {
                      id: true,
                      vendorId: true,
                      currency: true,
                      vendor: { select: { id: true, code: true, name: true } },
                    },
                  },
                },
              },
            },
          },
          purchaseOrders: {
            select: {
              id: true,
              correlative: true,
              status: true,
              totalAmount: true,
              currency: true,
              quotationId: true,
              items: { select: { sourceQuotationItemId: true } },
            },
            orderBy: { createdAt: 'desc' },
          },
          quotations: {
            include: {
              vendor: { select: { id: true, code: true, name: true } },
              items: {
                include: {
                  requisitionItem: {
                    select: {
                      id: true,
                      description: true,
                      quantity: true,
                      unitOfMeasure: true,
                      partNumber: true,
                      itemNotes: true,
                      inventoryItemId: true,
                      inventoryItem: {
                        select: { id: true, partNumber: true, name: true },
                      },
                    },
                  },
                },
              },
            },
            orderBy: { createdAt: 'desc' },
          },
        },
      }),
      this.prisma.purchaseDocument.findMany({
        where: { tenantId, entity: 'REQUISITION', entityId: id },
        orderBy: { createdAt: 'desc' },
        include: {
          uploadedBy: { select: { id: true, name: true, email: true } },
        },
      }),
    ]);
    if (!requisition)
      throw new NotFoundException('Requerimiento no encontrado');

    if (user) {
      assertUserHasContractAccess(user, requisition.contractId);
    }

    const reconciliationSnapshot = await buildRequisitionReconciliationSnapshot(
      this.prisma,
      tenantId,
      requisition.id,
      requisition.items.map((i) => ({
        id: i.id,
        quantity: Number(i.quantity),
        awardedQuotationItemId: i.awardedQuotationItemId,
      })),
    );

    const quotations = await Promise.all(
      requisition.quotations.map(async (q) => ({
        ...q,
        attachmentUrl: q.attachmentUrl
          ? await this.storageService.getReadOnlyUrl(q.attachmentUrl)
          : null,
      })),
    );

    return {
      ...requisition,
      quotations,
      reconciliationSnapshot,
      purchaseDocuments,
    };
  }

  /**
   * Auditoría del requerimiento (creación, envío, cotizaciones vía metadatos en otros eventos si aplica).
   */
  async findActivityLogs(requisitionId: string, tenantId: string) {
    const req = await this.prisma.purchaseRequisition.findFirst({
      where: { id: requisitionId, tenantId },
      select: { id: true },
    });
    if (!req) throw new NotFoundException('Requerimiento no encontrado');

    return this.prisma.activityLog.findMany({
      where: {
        tenantId,
        entityType: 'REQUISITION',
        entityId: requisitionId,
      },
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
    });
  }

  async create(
    data: {
      contractId: string;
      subcontractId?: string;
      description: string;
      justification?: string;
      priority?: 'LOW' | 'MEDIUM' | 'HIGH';
      workOrderId?: string | null;
      equipmentId?: string | null;
      items: Array<{
        inventoryItemId?: string;
        description: string;
        quantity: number;
        unitOfMeasure: string;
        estimatedCost?: number;
        partNumber?: string;
        itemNotes?: string;
      }>;
    },
    user: any,
  ) {
    const tenantId = user.tenantId;

    if (
      !data.contractId ||
      data.contractId === 'ALL' ||
      !isUuid(data.contractId)
    ) {
      throw new BadRequestException(
        'Debe indicar un contrato válido. Si usa la vista global, elija un contrato en el formulario.',
      );
    }

    const contract = await this.prisma.contract.findFirst({
      where: { id: data.contractId, tenantId },
      select: { id: true },
    });
    if (!contract) {
      throw new BadRequestException(
        'El contrato no existe o no pertenece a su organización',
      );
    }

    if (data.subcontractId) {
      if (!isUuid(data.subcontractId)) {
        throw new BadRequestException('ID de subcontrato inválido');
      }
      const sub = await this.prisma.subcontract.findFirst({
        where: { id: data.subcontractId, contractId: data.contractId },
        select: { id: true },
      });
      if (!sub) {
        throw new BadRequestException(
          'El subcontrato no pertenece al contrato seleccionado',
        );
      }
    }

    const woIn =
      data.workOrderId != null && String(data.workOrderId).trim() !== ''
        ? String(data.workOrderId).trim()
        : null;
    const eqIn =
      data.equipmentId != null && String(data.equipmentId).trim() !== ''
        ? String(data.equipmentId).trim()
        : null;

    const assetLinks = await this.resolveRequisitionAssetLinks(
      this.prisma,
      tenantId,
      data.contractId,
      data.subcontractId ?? null,
      woIn,
      eqIn,
    );

    if (!Array.isArray(data.items) || data.items.length === 0) {
      throw new BadRequestException(
        'El requerimiento debe tener al menos un ítem',
      );
    }
    await this.ensureRequisitionItemsCatalogLinked(tenantId, data.items);
    this.assertRequisitionLineQuantities(data.items);

    const created = await this.prisma.$transaction(async (tx) => {
      const correlative = await this.sequenceService.getNextCorrelative(
        tenantId,
        'SRC',
        'SRC',
        tx,
      );

      return tx.purchaseRequisition.create({
        data: {
          tenantId,
          contractId: data.contractId,
          subcontractId: data.subcontractId || undefined,
          correlative,
          requestedById: user.id,
          description: data.description,
          justification: data.justification,
          priority: data.priority ?? 'MEDIUM',
          equipmentId: assetLinks.equipmentId ?? undefined,
          workOrderId: assetLinks.workOrderId ?? undefined,
          items: {
            create: data.items.map((item) => ({
              description: item.description,
              quantity: item.quantity,
              unitOfMeasure: item.unitOfMeasure,
              estimatedCost: item.estimatedCost,
              inventoryItemId: item.inventoryItemId,
              partNumber: item.partNumber ?? undefined,
              itemNotes: item.itemNotes ?? undefined,
            })),
          },
        },
        include: {
          items: true,
          requestedBy: { select: { id: true, name: true } },
          equipment: EQUIPMENT_LINK_SELECT,
          workOrder: WORK_ORDER_LINK_SELECT,
        },
      });
    });

    await this.audit.log({
      userId: user.id,
      tenantId,
      entityType: 'REQUISITION',
      entityId: created.id,
      action: 'CREATE',
      newValue: {
        correlative: created.correlative,
        status: created.status,
        description: created.description,
        itemsCount: created.items.length,
        itemsSnapshot: requisitionItemsSnapshot(created.items),
        equipmentId: created.equipmentId,
        workOrderId: created.workOrderId,
        equipmentRef: created.equipment?.internalId ?? null,
        equipmentName: created.equipment
          ? equipmentDisplayName(created.equipment)
          : null,
        workOrderRef: created.workOrder?.correlative ?? null,
        workOrderSummary: created.workOrder
          ? workOrderDisplayName(created.workOrder)
          : null,
      },
    });

    return created;
  }

  async update(id: string, data: any, user: any) {
    const requisition = await this.findById(id, user.tenantId);

    const hasWorkOrderKey = Object.prototype.hasOwnProperty.call(
      data,
      'workOrderId',
    );
    const hasEquipmentKey = Object.prototype.hasOwnProperty.call(
      data,
      'equipmentId',
    );
    const wantsAssetLinkChange = hasWorkOrderKey || hasEquipmentKey;

    const isPurchaser = ['ADMIN', 'SUPER_ADMIN', 'SUPERVISOR'].includes(
      user.role,
    );
    const isOwnerOrAdmin =
      requisition.requestedById === user.id ||
      user.role === 'ADMIN' ||
      user.role === 'SUPER_ADMIN';

    if (wantsAssetLinkChange) {
      if (!['DRAFT', 'SUBMITTED'].includes(requisition.status)) {
        throw new BadRequestException(
          'Solo se pueden modificar equipo y orden de trabajo mientras el requerimiento está en borrador o enviado',
        );
      }
      if (!isOwnerOrAdmin) {
        throw new ForbiddenException(
          'Solo el solicitante o un administrador puede modificar el vínculo con equipo u orden de trabajo',
        );
      }
    }

    const otherDefinedKeys = Object.keys(data).filter((k) => {
      if (k === 'workOrderId' || k === 'equipmentId') return false;
      return data[k] !== undefined;
    });

    const parseOptionalUuid = (v: unknown): string | null => {
      if (v === null || v === undefined) return null;
      const s = String(v).trim();
      if (s === '') return null;
      return s;
    };

    /** Enviado: únicamente OT / equipo. */
    if (requisition.status === 'SUBMITTED') {
      if (otherDefinedKeys.length > 0) {
        throw new BadRequestException(
          'En estado Enviado solo puede actualizar equipo y orden de trabajo',
        );
      }
      if (!wantsAssetLinkChange) {
        throw new BadRequestException(
          'No hay cambios permitidos para este requerimiento en estado enviado',
        );
      }

      const mergedWo = hasWorkOrderKey
        ? parseOptionalUuid(data.workOrderId)
        : (requisition.workOrderId ?? null);
      const mergedEq = hasEquipmentKey
        ? parseOptionalUuid(data.equipmentId)
        : (requisition.equipmentId ?? null);

      const resolved = await this.resolveRequisitionAssetLinks(
        this.prisma,
        user.tenantId,
        requisition.contractId,
        requisition.subcontractId ?? null,
        mergedWo,
        mergedEq,
      );

      const before = {
        equipmentId: requisition.equipmentId,
        workOrderId: requisition.workOrderId,
        equipmentRef: requisition.equipment?.internalId ?? null,
        equipmentName: requisition.equipment
          ? equipmentDisplayName(requisition.equipment)
          : null,
        workOrderRef: requisition.workOrder?.correlative ?? null,
        workOrderSummary: requisition.workOrder
          ? workOrderDisplayName(requisition.workOrder)
          : null,
      };

      const updated = await this.prisma.purchaseRequisition.update({
        where: { id },
        data: {
          equipmentId: resolved.equipmentId,
          workOrderId: resolved.workOrderId,
        },
        include: {
          items: true,
          equipment: EQUIPMENT_LINK_SELECT,
          workOrder: WORK_ORDER_LINK_SELECT,
        },
      });

      const after = {
        equipmentId: updated.equipmentId,
        workOrderId: updated.workOrderId,
        equipmentRef: updated.equipment?.internalId ?? null,
        equipmentName: updated.equipment
          ? equipmentDisplayName(updated.equipment)
          : null,
        workOrderRef: updated.workOrder?.correlative ?? null,
        workOrderSummary: updated.workOrder
          ? workOrderDisplayName(updated.workOrder)
          : null,
      };

      const { oldValue, newValue } = pickChanged(
        before as Record<string, unknown>,
        after as Record<string, unknown>,
      );
      if (Object.keys(oldValue).length > 0) {
        await this.audit.log({
          userId: user.id,
          tenantId: user.tenantId,
          entityType: 'REQUISITION',
          entityId: id,
          action: 'UPDATE',
          oldValue,
          newValue,
        });
      }

      return updated;
    }

    const canEditDraft = requisition.status === 'DRAFT' && isOwnerOrAdmin;
    const canEditQuoting = requisition.status === 'QUOTING' && isPurchaser;
    /** Ganadora elegida pero OC aún no generada: compras puede seguir ajustando ítems. */
    const canEditPendingWinner =
      requisition.status === 'PENDING_APPROVAL' && isPurchaser;
    const canEditPartialPurchase =
      requisition.status === 'PARTIALLY_PURCHASED' && isPurchaser;

    if (
      !canEditDraft &&
      !canEditQuoting &&
      !canEditPendingWinner &&
      !canEditPartialPurchase
    ) {
      if (requisition.status === 'QUOTING') {
        throw new ForbiddenException(
          'Solo personal de compras puede editar un requerimiento en fase de cotización',
        );
      }
      if (requisition.status === 'PENDING_APPROVAL') {
        throw new ForbiddenException(
          'Solo personal de compras puede editar mientras la OC no haya sido generada',
        );
      }
      throw new BadRequestException(
        'Solo se pueden editar requerimientos en borrador (solicitante o admin), en cotización o pendiente de OC (compras)',
      );
    }

    if (data.items && Array.isArray(data.items) && data.items.length === 0) {
      throw new BadRequestException(
        'El requerimiento debe tener al menos un ítem',
      );
    }

    if (data.items && Array.isArray(data.items) && data.items.length > 0) {
      await this.ensureRequisitionItemsCatalogLinked(
        user.tenantId,
        data.items,
      );
      this.assertRequisitionLineQuantities(data.items);
    }

    let resolvedAssets:
      | { equipmentId: string | null; workOrderId: string | null }
      | undefined;
    if (wantsAssetLinkChange && requisition.status === 'DRAFT') {
      const mergedWo = hasWorkOrderKey
        ? parseOptionalUuid(data.workOrderId)
        : (requisition.workOrderId ?? null);
      const mergedEq = hasEquipmentKey
        ? parseOptionalUuid(data.equipmentId)
        : (requisition.equipmentId ?? null);

      resolvedAssets = await this.resolveRequisitionAssetLinks(
        this.prisma,
        user.tenantId,
        requisition.contractId,
        requisition.subcontractId ?? null,
        mergedWo,
        mergedEq,
      );
    }

    const before = {
      description: requisition.description,
      justification: requisition.justification ?? null,
      priority: requisition.priority,
      itemsSnapshot: requisitionItemsSnapshot(requisition.items),
      equipmentId: requisition.equipmentId,
      workOrderId: requisition.workOrderId,
      equipmentRef: requisition.equipment?.internalId ?? null,
      equipmentName: requisition.equipment
        ? equipmentDisplayName(requisition.equipment)
        : null,
      workOrderRef: requisition.workOrder?.correlative ?? null,
      workOrderSummary: requisition.workOrder
        ? workOrderDisplayName(requisition.workOrder)
        : null,
    };

    const updated = await this.prisma.$transaction(async (tx) => {
      if (data.items && Array.isArray(data.items)) {
        if (requisition.status === 'DRAFT') {
          await tx.requisitionItem.deleteMany({ where: { requisitionId: id } });
          await tx.requisitionItem.createMany({
            data: data.items.map((item: any) => ({
              requisitionId: id,
              description: item.description,
              quantity: item.quantity,
              unitOfMeasure: item.unitOfMeasure,
              estimatedCost: item.estimatedCost,
              inventoryItemId: item.inventoryItemId,
              partNumber: item.partNumber ?? undefined,
              itemNotes: item.itemNotes ?? undefined,
            })),
          });
        } else {
          const existingItems = requisition.items;
          const payloadItems: any[] = data.items;
          const payloadIds = new Set(
            payloadItems.map((i) => i.id).filter(Boolean),
          );

          for (const old of existingItems) {
            if (!payloadIds.has(old.id)) {
              const refCount = await tx.quotationItem.count({
                where: { requisitionItemId: old.id },
              });
              if (refCount > 0) {
                throw new BadRequestException(
                  'No se puede eliminar un ítem que ya figura en una cotización',
                );
              }
              await tx.requisitionItem.delete({ where: { id: old.id } });
            }
          }

          for (const item of payloadItems) {
            if (item.id && existingItems.some((e) => e.id === item.id)) {
              await tx.requisitionItem.update({
                where: { id: item.id },
                data: {
                  description: item.description,
                  quantity: item.quantity,
                  unitOfMeasure: item.unitOfMeasure,
                  estimatedCost: item.estimatedCost,
                  inventoryItemId: item.inventoryItemId ?? null,
                  partNumber: item.partNumber ?? null,
                  itemNotes: item.itemNotes ?? null,
                },
              });
            } else {
              await tx.requisitionItem.create({
                data: {
                  requisitionId: id,
                  description: item.description,
                  quantity: item.quantity,
                  unitOfMeasure: item.unitOfMeasure,
                  estimatedCost: item.estimatedCost,
                  inventoryItemId: item.inventoryItemId ?? undefined,
                  partNumber: item.partNumber ?? undefined,
                  itemNotes: item.itemNotes ?? undefined,
                },
              });
            }
          }
        }
      }

      return tx.purchaseRequisition.update({
        where: { id },
        data: {
          ...(data.description !== undefined
            ? { description: data.description }
            : {}),
          ...(data.justification !== undefined
            ? { justification: data.justification }
            : {}),
          ...(data.priority !== undefined &&
          ['LOW', 'MEDIUM', 'HIGH'].includes(String(data.priority))
            ? { priority: data.priority }
            : {}),
          ...(resolvedAssets
            ? {
                equipmentId: resolvedAssets.equipmentId,
                workOrderId: resolvedAssets.workOrderId,
              }
            : {}),
        },
        include: {
          items: true,
          equipment: EQUIPMENT_LINK_SELECT,
          workOrder: WORK_ORDER_LINK_SELECT,
        },
      });
    });

    const after = {
      description: updated.description,
      justification: updated.justification ?? null,
      priority: updated.priority,
      itemsSnapshot: requisitionItemsSnapshot(updated.items),
      equipmentId: updated.equipmentId,
      workOrderId: updated.workOrderId,
      equipmentRef: updated.equipment?.internalId ?? null,
      equipmentName: updated.equipment
        ? equipmentDisplayName(updated.equipment)
        : null,
      workOrderRef: updated.workOrder?.correlative ?? null,
      workOrderSummary: updated.workOrder
        ? workOrderDisplayName(updated.workOrder)
        : null,
    };
    const { oldValue, newValue } = pickChanged(
      before as Record<string, unknown>,
      after as Record<string, unknown>,
    );
    if (Object.keys(oldValue).length > 0) {
      await this.audit.log({
        userId: user.id,
        tenantId: user.tenantId,
        entityType: 'REQUISITION',
        entityId: id,
        action: 'UPDATE',
        oldValue,
        newValue,
      });
    }

    return updated;
  }

  async duplicate(id: string, user: any) {
    const original = await this.findById(id, user.tenantId);

    return this.create(
      {
        contractId: original.contractId,
        subcontractId: original.subcontractId ?? undefined,
        description: `[Copia] ${original.description}`,
        justification: original.justification ?? undefined,
        priority: original.priority,
        workOrderId: original.workOrderId ?? undefined,
        equipmentId: original.equipmentId ?? undefined,
        items: original.items.map((item) => ({
          inventoryItemId: item.inventoryItemId ?? undefined,
          description: item.description,
          quantity: Number(item.quantity),
          unitOfMeasure: item.unitOfMeasure,
          estimatedCost:
            item.estimatedCost != null ? Number(item.estimatedCost) : undefined,
          partNumber: item.partNumber ?? undefined,
          itemNotes: item.itemNotes ?? undefined,
        })),
      },
      user,
    );
  }

  async submit(id: string, user: any) {
    const requisition = await this.findById(id, user.tenantId);

    if (requisition.status !== 'DRAFT') {
      throw new BadRequestException(
        'Solo se pueden enviar requerimientos en estado DRAFT',
      );
    }
    if (requisition.items.length === 0) {
      throw new BadRequestException(
        'El requerimiento debe tener al menos un ítem',
      );
    }

    await this.ensureRequisitionItemsCatalogLinked(
      user.tenantId,
      requisition.items,
    );
    this.assertRequisitionLineQuantities(requisition.items);

    const prevStatus = requisition.status;
    const updated = await this.prisma.purchaseRequisition.update({
      where: { id },
      data: { status: 'SUBMITTED' },
    });

    await this.audit.log({
      userId: user.id,
      tenantId: user.tenantId,
      entityType: 'REQUISITION',
      entityId: id,
      action: 'STATUS_CHANGE',
      oldValue: { status: prevStatus },
      newValue: { status: updated.status },
    });

    return updated;
  }

  async cancel(id: string, reason: string | undefined, user: any) {
    const requisition = await this.findById(id, user.tenantId);
    assertUserHasContractAccess(user, requisition.contractId);

    const cancelReason = reason?.trim();
    if (!cancelReason) {
      throw new BadRequestException(
        'Debe ingresar un motivo de anulación del requerimiento.',
      );
    }
    if (requisition.status === 'CANCELLED') {
      throw new BadRequestException('El requerimiento ya está anulado.');
    }
    if (requisition.status === 'APPROVED') {
      throw new BadRequestException(
        'No se puede anular un requerimiento ya aprobado.',
      );
    }

    const linkedOrder = await this.prisma.purchaseOrder.findFirst({
      where: {
        tenantId: user.tenantId,
        status: { notIn: [...PO_INACTIVE_FOR_LINK] },
        OR: [{ requisitionId: id }, { quotation: { requisitionId: id } }],
      },
      select: { id: true, correlative: true, status: true },
    });
    if (linkedOrder) {
      throw new BadRequestException(
        `No se puede anular: el requerimiento ya tiene una OC activa vinculada (${linkedOrder.correlative}).`,
      );
    }

    const reqLinesWithStock = await this.prisma.requisitionItem.findMany({
      where: {
        requisitionId: id,
        inventoryItemId: { not: null },
      },
      select: {
        id: true,
        description: true,
        inventoryItem: {
          select: {
            stocks: {
              select: { quantity: true, minStock: true },
            },
          },
        },
      },
    });
    const lowStockCriticalLines = reqLinesWithStock.filter((line) =>
      (line.inventoryItem?.stocks ?? []).some(
        (s) =>
          Number(s.minStock) > 0 && Number(s.quantity) <= Number(s.minStock),
      ),
    );

    const prevStatus = requisition.status;
    const updated = await this.prisma.purchaseRequisition.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });

    await this.audit.log({
      userId: user.id,
      tenantId: user.tenantId,
      entityType: 'REQUISITION',
      entityId: id,
      action: 'STATUS_CHANGE',
      oldValue: { status: prevStatus },
      newValue: {
        status: updated.status,
        reason: cancelReason,
        lowStockCriticalItems: lowStockCriticalLines.length,
      },
    });

    return updated;
  }

  async startQuoting(id: string, user: any) {
    const requisition = await this.findById(id, user.tenantId);

    if (requisition.status !== 'SUBMITTED') {
      throw new BadRequestException(
        'Solo se puede iniciar cotización cuando el requerimiento está enviado (Enviado)',
      );
    }

    const prevStatus = requisition.status;
    await this.prisma.purchaseRequisition.update({
      where: { id },
      data: { status: 'QUOTING' },
    });

    await this.audit.log({
      userId: user.id,
      tenantId: user.tenantId,
      entityType: 'REQUISITION',
      entityId: id,
      action: 'STATUS_CHANGE',
      oldValue: { status: prevStatus },
      newValue: { status: 'QUOTING' },
    });

    return this.findById(id, user.tenantId);
  }

  async addQuotation(
    requisitionId: string,
    data: {
      vendorId: string;
      totalAmount: number;
      currency?: string;
      deliveryDays?: number;
      /** Plazo de pago en días (desde factura); 0 = contado. */
      paymentDays?: number;
      validUntil?: string;
      items: Array<{
        requisitionItemId: string;
        unitPrice: number;
        brand?: string;
        notes?: string;
      }>;
    },
    file:
      | { buffer: Buffer; originalname: string; mimetype: string }
      | undefined,
    user: any,
  ) {
    const requisition = await this.findById(requisitionId, user.tenantId);

    if (
      ![
        'SUBMITTED',
        'QUOTING',
        'PENDING_APPROVAL',
        'PARTIALLY_PURCHASED',
      ].includes(requisition.status)
    ) {
      throw new BadRequestException(
        'El requerimiento no acepta cotizaciones en su estado actual',
      );
    }

    let attachmentUrl: string | undefined;
    if (file) {
      attachmentUrl = await this.storageService.uploadFile(file, 'quotations');
    }

    const reqStatusBefore = requisition.status;

    const qtyByReqItemId = new Map(
      requisition.items.map((ri) => [ri.id, Number(ri.quantity)]),
    );
    let computedTotal = 0;
    for (const line of data.items) {
      const qty = qtyByReqItemId.get(line.requisitionItemId);
      if (qty === undefined) {
        throw new BadRequestException(
          'Uno o más ítems de la cotización no pertenecen a este requerimiento',
        );
      }
      computedTotal += line.unitPrice * qty;
    }
    const declared = Number(data.totalAmount);
    if (Math.round(computedTotal * 100) !== Math.round(declared * 100)) {
      throw new BadRequestException(
        'El monto total no coincide con la suma de precio unitario × cantidad de los ítems de la cotización',
      );
    }

    if (data.paymentDays !== undefined && data.paymentDays !== null) {
      const pd = Number(data.paymentDays);
      if (!Number.isFinite(pd) || !Number.isInteger(pd) || pd < 0 || pd > 3650) {
        throw new BadRequestException(
          'Plazo de pago (días) inválido: use un entero entre 0 y 3650',
        );
      }
    }

    const quotation = await this.prisma.$transaction(async (tx) => {
      const q = await tx.purchaseQuotation.create({
        data: {
          tenantId: user.tenantId,
          requisitionId,
          vendorId: data.vendorId,
          totalAmount: data.totalAmount,
          currency: data.currency ?? 'CLP',
          deliveryDays: data.deliveryDays,
          paymentDays:
            data.paymentDays !== undefined && data.paymentDays !== null
              ? Math.trunc(Number(data.paymentDays))
              : undefined,
          validUntil: data.validUntil ? new Date(data.validUntil) : undefined,
          attachmentUrl,
          items: {
            create: data.items.map((item) => ({
              requisitionItemId: item.requisitionItemId,
              unitPrice: item.unitPrice,
              brand: item.brand,
              notes: item.notes,
            })),
          },
        },
        include: {
          vendor: { select: { id: true, code: true, name: true } },
          items: true,
        },
      });

      if (requisition.status === 'SUBMITTED') {
        await tx.purchaseRequisition.update({
          where: { id: requisitionId },
          data: { status: 'QUOTING' },
        });
      }

      return q;
    });

    if (reqStatusBefore === 'SUBMITTED') {
      await this.audit.log({
        userId: user.id,
        tenantId: user.tenantId,
        entityType: 'REQUISITION',
        entityId: requisitionId,
        action: 'STATUS_CHANGE',
        oldValue: { status: reqStatusBefore },
        newValue: { status: 'QUOTING' },
      });
    }

    await this.audit.log({
      userId: user.id,
      tenantId: user.tenantId,
      entityType: 'REQUISITION',
      entityId: requisitionId,
      action: 'UPDATE',
      newValue: {
        event: 'quotation_added',
        quotationId: quotation.id,
        vendorId: data.vendorId,
        vendorName: quotation.vendor?.name,
        totalAmount: Number(quotation.totalAmount),
      },
    });

    return quotation;
  }

  /**
   * Adjudicación por ítem (split multiproveedor). No modifica adjudicación de líneas
   * que ya tienen una OC activa vinculada a la cotización adjudicada previa.
   */
  async saveLineAwards(
    requisitionId: string,
    dto: SaveLineAwardsDto,
    user: any,
  ) {
    const tenantId = user.tenantId;
    const requisition = await this.findById(requisitionId, tenantId, user);

    if (
      ![
        'QUOTING',
        'PENDING_APPROVAL',
        'PARTIALLY_PURCHASED',
        'APPROVED',
      ].includes(requisition.status)
    ) {
      throw new BadRequestException(
        'Solo se puede adjudicar por línea en cotización, pendiente de aprobación, compra parcial o requerimiento cerrado con líneas aún sin OC (p. ej. ítems nuevos)',
      );
    }

    const reqItemIds = dto.awards.map((a) => a.requisitionItemId);
    if (new Set(reqItemIds).size !== reqItemIds.length) {
      throw new BadRequestException(
        'Hay ítems de requerimiento duplicados en la adjudicación',
      );
    }

    for (const a of dto.awards) {
      const reqItem = requisition.items.find(
        (i) => i.id === a.requisitionItemId,
      );
      if (!reqItem) {
        throw new BadRequestException(
          `Ítem de requerimiento no pertenece a este SRC: ${a.requisitionItemId}`,
        );
      }
      if (reqItem.awardedQuotationItemId) {
        const locked = await this.prisma.purchaseOrderItem.findFirst({
          where: {
            sourceQuotationItemId: reqItem.awardedQuotationItemId,
            purchaseOrder: {
              tenantId,
              status: { notIn: [...PO_INACTIVE_FOR_LINK] },
              OR: [{ requisitionId }, { quotation: { requisitionId } }],
            },
          },
        });
        if (locked) {
          throw new BadRequestException(
            'No puede cambiar la adjudicación de una línea que ya tiene orden de compra activa',
          );
        }
      }

      const qi = await this.prisma.quotationItem.findFirst({
        where: {
          id: a.quotationItemId,
          requisitionItemId: a.requisitionItemId,
          quotation: { requisitionId, tenantId },
        },
      });
      if (!qi) {
        throw new BadRequestException(
          'La línea de cotización no corresponde al ítem en este requerimiento',
        );
      }
    }

    const statusBefore = requisition.status;

    let quotationStatusChanges: QuotationStatusChange[] = [];

    await this.prisma.$transaction(async (tx) => {
      for (const a of dto.awards) {
        await tx.requisitionItem.update({
          where: { id: a.requisitionItemId },
          data: { awardedQuotationItemId: a.quotationItemId },
        });
      }

      const itemsAfter = await tx.requisitionItem.findMany({
        where: { requisitionId },
        select: { awardedQuotationItemId: true },
      });
      const allAwarded =
        itemsAfter.length > 0 &&
        itemsAfter.every((i) => i.awardedQuotationItemId != null);

      if (statusBefore === 'QUOTING' && allAwarded) {
        await tx.purchaseRequisition.update({
          where: { id: requisitionId },
          data: { status: 'PENDING_APPROVAL' },
        });
      }

      quotationStatusChanges =
        await syncPurchaseQuotationStatusesFromLineAwards(tx, requisitionId);
    });

    const updated = await this.findById(requisitionId, tenantId, user);

    await this.audit.log({
      userId: user.id,
      tenantId,
      entityType: 'REQUISITION',
      entityId: requisitionId,
      action: 'UPDATE',
      newValue: {
        event: 'line_awards_saved',
        awardsCount: dto.awards.length,
        statusAfter: updated.status,
      },
    });

    if (statusBefore === 'QUOTING' && updated.status === 'PENDING_APPROVAL') {
      await this.audit.log({
        userId: user.id,
        tenantId,
        entityType: 'REQUISITION',
        entityId: requisitionId,
        action: 'STATUS_CHANGE',
        oldValue: { status: statusBefore },
        newValue: { status: 'PENDING_APPROVAL', reason: 'all_lines_awarded' },
      });
    }

    if (quotationStatusChanges.length) {
      await this.audit.log({
        userId: user.id,
        tenantId,
        entityType: 'REQUISITION',
        entityId: requisitionId,
        action: 'UPDATE',
        newValue: {
          event: 'quotation_statuses_synced',
          changes: quotationStatusChanges,
        },
      });
    }

    return updated;
  }

  async selectQuotation(requisitionId: string, quotationId: string, user: any) {
    const requisition = await this.findById(requisitionId, user.tenantId);

    if (!['QUOTING', 'PENDING_APPROVAL'].includes(requisition.status)) {
      throw new BadRequestException(
        'Solo se puede elegir ganadora en cotización o antes de generar la orden de compra',
      );
    }

    const quotation = requisition.quotations.find((q) => q.id === quotationId);
    if (!quotation) {
      throw new NotFoundException(
        'Cotización no encontrada en este requerimiento',
      );
    }

    const statusBefore = requisition.status;
    const previousWinner = requisition.quotations.find((q) => q.isWinner);

    const result = await this.prisma.$transaction(async (tx) => {
      /** Permite elegir una oferta que estaba como REJECTED al cambiar de ganadora. */
      if (statusBefore === 'PENDING_APPROVAL') {
        await tx.purchaseQuotation.updateMany({
          where: { requisitionId },
          data: { status: 'RECEIVED', isWinner: false },
        });
      }

      await tx.purchaseQuotation.updateMany({
        where: { requisitionId, id: { not: quotationId } },
        data: { status: 'REJECTED', isWinner: false },
      });

      await tx.purchaseQuotation.update({
        where: { id: quotationId },
        data: { status: 'SELECTED', isWinner: true },
      });

      if (statusBefore === 'QUOTING') {
        await tx.purchaseRequisition.update({
          where: { id: requisitionId },
          data: { status: 'PENDING_APPROVAL' },
        });
      }

      return tx.purchaseQuotation.findUnique({
        where: { id: quotationId },
        include: {
          vendor: { select: { id: true, code: true, name: true } },
          items: true,
        },
      });
    });

    if (statusBefore === 'QUOTING') {
      await this.audit.log({
        userId: user.id,
        tenantId: user.tenantId,
        entityType: 'REQUISITION',
        entityId: requisitionId,
        action: 'STATUS_CHANGE',
        oldValue: { status: statusBefore },
        newValue: {
          status: 'PENDING_APPROVAL',
          selectedQuotationId: quotationId,
        },
      });
    } else {
      await this.audit.log({
        userId: user.id,
        tenantId: user.tenantId,
        entityType: 'REQUISITION',
        entityId: requisitionId,
        action: 'UPDATE',
        oldValue: {
          event: 'winner_selection_changed',
          previousWinnerQuotationId: previousWinner?.id ?? null,
          previousVendorName: previousWinner?.vendor?.name ?? null,
        },
        newValue: {
          event: 'winner_selection_changed',
          selectedQuotationId: quotationId,
          vendorName: result?.vendor?.name ?? null,
          status: 'PENDING_APPROVAL',
        },
      });
    }

    return result;
  }
}
