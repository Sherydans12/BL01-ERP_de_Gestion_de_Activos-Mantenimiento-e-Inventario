import { OperationalStatus } from '@prisma/client';

/** Entrada al orquestador (misma transacción que el parte M2). */
export interface OperationalTransitionInput {
  tenantId: string;
  equipmentId: string;
  availabilityId: string;
  newStatus: OperationalStatus;
  /** Estado del mismo turno/fecha antes del upsert; null en create nuevo. */
  previousStatus: OperationalStatus | null;
  meterReading?: number | null;
  comments?: string | null;
  /** ISO date (yyyy-mm-dd) del turno reportado. */
  reportDate: string;
  reportedById: string;
}

export type OperationalTransitionSkipReason =
  | 'ACTIVE_FAULT_EXISTS'
  | 'NOT_APPLICABLE_STATUS'
  | 'NO_CONTRACT_FOR_STUB';

/** Resultado de dominio devuelto por el orquestador. */
export interface OperationalTransitionResult {
  equipmentId: string;
  isOperational: boolean;
  faultReportId?: string;
  faultReportCorrelative?: string;
  createdFaultReport: boolean;
  requiresFaultCompletion: boolean;
  skippedReason?: OperationalTransitionSkipReason;
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
