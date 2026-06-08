import {
  AvailabilityImpact,
  FaultCriticality,
  FaultReportStatus,
  OtStatus,
  Prisma,
} from '@prisma/client';

// ────────────────────────────────────────────────────────────────────────────────
// Bloqueadores operacionales — función pura reutilizable por el Orquestador M2
// y por WorkOrdersService al cierre de OT.
//
// Un bloqueador impide la transición Equipment.isOperational → true.
// Diseño: se ejecuta con el TransactionClient de la transacción Serializable
// del llamador, garantizando lectura consistente dentro de la misma transacción.
// ────────────────────────────────────────────────────────────────────────────────

/** Causa individual que impide el retorno a servicio de un equipo. */
export interface OperationalBlocker {
  /** Tipo de causa: falla HIGH activa u OT que afecta disponibilidad. */
  type: 'HIGH_FAULT' | 'AVAILABILITY_WORK_ORDER';
  /** ID del registro que origina el bloqueo (FaultReport.id o WorkOrder.id). */
  sourceId: string;
  /** Correlativo legible (RF-XXXXX u OT-YYYY-NNN). */
  correlative: string;
  /** Estado actual del registro bloqueante. */
  status: string;
}

/** Resultado de la evaluación de retorno a servicio. */
export interface ReturnToServiceDecision {
  /** Aislamiento multi-tenant. */
  tenantId: string;
  /** Equipo evaluado. */
  equipmentId: string;
  /** true si el equipo puede volver a operativo. */
  allowed: boolean;
  /** Lista de causas que impiden la reactivación (vacía si allowed=true). */
  blockers: OperationalBlocker[];
}

/**
 * Evalúa si un equipo puede volver a servicio (isOperational → true).
 *
 * @param tx           Cliente transaccional Prisma (Serializable).
 * @param tenantId     Aislamiento multi-tenant.
 * @param equipmentId  Equipo evaluado.
 * @param opts.excludeWorkOrderId  OT a excluir de la consulta (cuando se
 *                                 está cerrando esa OT y no debe bloquearse
 *                                 a sí misma).
 */
export async function resolveReturnToService(
  tx: Prisma.TransactionClient,
  tenantId: string,
  equipmentId: string,
  opts?: { excludeWorkOrderId?: string },
): Promise<ReturnToServiceDecision> {
  const blockers: OperationalBlocker[] = [];

  // ── 1. FaultReports bloqueantes: HIGH activas ─────────────────────────────
  // Una falla HIGH en estado OPEN o LINKED (con OT no cerrada) justifica
  // mantener el equipo fuera de servicio.
  const blockingFaults = await tx.faultReport.findMany({
    where: {
      tenantId,
      equipmentId,
      criticality: FaultCriticality.HIGH,
      OR: [
        { status: FaultReportStatus.OPEN },
        {
          status: FaultReportStatus.LINKED,
          OR: [
            { workOrderId: null },
            { workOrder: { status: { not: OtStatus.CLOSED } } },
          ],
        },
      ],
    },
    select: {
      id: true,
      correlative: true,
      status: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  for (const fault of blockingFaults) {
    blockers.push({
      type: 'HIGH_FAULT',
      sourceId: fault.id,
      correlative: fault.correlative,
      status: fault.status,
    });
  }

  // ── 2. WorkOrders bloqueantes: affectsAvailability=SI y no cerradas ───────
  const woWhere: Prisma.WorkOrderWhereInput = {
    tenantId,
    equipmentId,
    affectsAvailability: AvailabilityImpact.SI,
    status: { in: [OtStatus.OPEN, OtStatus.IN_PROGRESS, OtStatus.ON_HOLD] },
  };
  if (opts?.excludeWorkOrderId) {
    woWhere.id = { not: opts.excludeWorkOrderId };
  }

  const blockingWos = await tx.workOrder.findMany({
    where: woWhere,
    select: {
      id: true,
      correlative: true,
      status: true,
      affectsAvailability: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  for (const wo of blockingWos) {
    blockers.push({
      type: 'AVAILABILITY_WORK_ORDER',
      sourceId: wo.id,
      correlative: wo.correlative,
      status: wo.status,
    });
  }

  return {
    tenantId,
    equipmentId,
    allowed: blockers.length === 0,
    blockers,
  };
}
