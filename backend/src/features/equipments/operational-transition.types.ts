import { OperationalStatus } from '@prisma/client';

/** Entrada al orquestador (misma transacción que el parte M2). */
export interface OperationalTransitionInput {
  tenantId: string;
  equipmentId: string;
  availabilityId: string;
  newStatus: OperationalStatus;
  /** Estado M2 anterior resuelto por disponibilidad; null si no hay historial. */
  previousStatus: OperationalStatus | null;
  meterReading?: number | null;
  comments?: string | null;
  /** ISO date (yyyy-mm-dd) del turno reportado. */
  reportDate: string;
  reportedById: string;
  /**
   * Decisión previa de bloqueadores para evitar doble consulta si
   * M2 ya evaluó el retorno a servicio de manera temprana.
   */
  validatedReturnDecision?: import('./operational-blockers').ReturnToServiceDecision;
}

export type OperationalTransitionSkipReason =
  | 'ACTIVE_FAULT_EXISTS'
  | 'NOT_APPLICABLE_STATUS'
  | 'NO_CONTRACT_FOR_STUB'
  | 'BLOCKED_BY_ACTIVE_CAUSES';

/** Resultado de dominio devuelto por el orquestador. */
export interface OperationalTransitionResult {
  equipmentId: string;
  isOperational: boolean;
  faultReportId?: string;
  faultReportCorrelative?: string;
  createdFaultReport: boolean;
  requiresFaultCompletion: boolean;
  skippedReason?: OperationalTransitionSkipReason;
  /** Causas activas que impidieron la reactivación (solo presente si skippedReason = BLOCKED_BY_ACTIVE_CAUSES). */
  blockers?: import('./operational-blockers').OperationalBlocker[];
}

/** Contrato API para el frontend (batch / import / create). */
export interface AvailabilitySideEffect {
  equipmentId: string;
  status: OperationalStatus;
  isOperational: boolean;
  faultReportId?: string;
  faultReportCorrelative?: string;
  createdFaultReport: boolean;
  requiresFaultCompletion: boolean;
}

export function toAvailabilitySideEffect(
  transition: OperationalTransitionResult,
  status: OperationalStatus,
): AvailabilitySideEffect {
  return {
    equipmentId: transition.equipmentId,
    status,
    isOperational: transition.isOperational,
    faultReportId: transition.faultReportId,
    faultReportCorrelative: transition.faultReportCorrelative,
    createdFaultReport: transition.createdFaultReport,
    requiresFaultCompletion: transition.requiresFaultCompletion,
  };
}
