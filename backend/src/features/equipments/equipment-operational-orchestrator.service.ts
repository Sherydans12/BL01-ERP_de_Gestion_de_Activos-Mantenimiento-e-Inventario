import { Injectable, NotFoundException } from '@nestjs/common';
import {
  AffectedSystem,
  FaultCriticality,
  FaultReportStatus,
  OperationalStatus,
  OtStatus,
  Prisma,
} from '@prisma/client';
import { SequenceService } from '../../common/sequence/sequence.service';
import {
  OperationalTransitionInput,
  OperationalTransitionResult,
} from './operational-transition.types';

/** Máx. 10 chars (`sequence_counters.document_type` VARCHAR(10)). */
const FR_DOCUMENT_TYPE = 'FAULT_REP';
const FR_PREFIX = 'RF';

const STOP_STATUSES: ReadonlySet<OperationalStatus> = new Set([
  OperationalStatus.DOWN_FAILURE,
  OperationalStatus.DOWN_MAINTENANCE,
]);

function isStopStatus(status: OperationalStatus): boolean {
  return STOP_STATUSES.has(status);
}

@Injectable()
export class EquipmentOperationalOrchestratorService {
  constructor(private readonly sequenceService: SequenceService) {}

  /**
   * Transiciones imperativas tras persistir un parte M2.
   * Debe ejecutarse dentro de la misma `$transaction` que el availability.
   */
  async onOperationalStatusChange(
    tx: Prisma.TransactionClient,
    input: OperationalTransitionInput,
  ): Promise<OperationalTransitionResult> {
    const equipment = await tx.equipment.findFirst({
      where: { id: input.equipmentId, tenantId: input.tenantId },
      select: { id: true, contractId: true, isOperational: true },
    });

    if (!equipment) {
      throw new NotFoundException(
        'El equipo no existe o no pertenece a este tenant.',
      );
    }

    const base: OperationalTransitionResult = {
      equipmentId: input.equipmentId,
      isOperational: equipment.isOperational,
      createdFaultReport: false,
      requiresFaultCompletion: false,
    };

    if (isStopStatus(input.newStatus)) {
      return this.applyStopTransition(tx, input, equipment, base);
    }

    if (
      input.newStatus === OperationalStatus.OPERATIONAL &&
      input.previousStatus != null &&
      isStopStatus(input.previousStatus)
    ) {
      await tx.equipment.update({
        where: { id: input.equipmentId },
        data: { isOperational: true },
      });
      return { ...base, isOperational: true };
    }

    return {
      ...base,
      skippedReason: 'NOT_APPLICABLE_STATUS',
    };
  }

  private async applyStopTransition(
    tx: Prisma.TransactionClient,
    input: OperationalTransitionInput,
    equipment: { id: string; contractId: string | null; isOperational: boolean },
    base: OperationalTransitionResult,
  ): Promise<OperationalTransitionResult> {
    const activeFault = await this.findActiveFaultReport(
      tx,
      input.tenantId,
      input.equipmentId,
    );

    let faultReportId = activeFault?.id;
    let faultReportCorrelative = activeFault?.correlative;
    let createdFaultReport = false;
    let requiresFaultCompletion = false;
    let skippedReason = base.skippedReason;

    if (!activeFault) {
      if (!equipment.contractId) {
        skippedReason = 'NO_CONTRACT_FOR_STUB';
      } else {
        const correlative = await this.sequenceService.getNextCorrelative(
          input.tenantId,
          FR_DOCUMENT_TYPE,
          FR_PREFIX,
          { tx, padWidth: 5 },
        );

        const eventDate = this.resolveEventDate(input.reportDate);
        const stub = await tx.faultReport.create({
          data: {
            tenantId: input.tenantId,
            contractId: equipment.contractId,
            equipmentId: input.equipmentId,
            reportedById: input.reportedById,
            correlative,
            eventDate,
            meterAtFault: input.meterReading ?? null,
            affectedSystem: AffectedSystem.MOTOR,
            criticality: FaultCriticality.LOW,
            symptomDescription: this.buildStubSymptom(
              input.comments,
              input.newStatus,
              input.reportDate,
            ),
            status: FaultReportStatus.OPEN,
          },
          select: { id: true, correlative: true },
        });

        faultReportId = stub.id;
        faultReportCorrelative = stub.correlative;
        createdFaultReport = true;
        requiresFaultCompletion = true;
      }
    } else {
      skippedReason = 'ACTIVE_FAULT_EXISTS';
    }

    await tx.equipment.update({
      where: { id: input.equipmentId },
      data: { isOperational: false },
    });

    return {
      equipmentId: input.equipmentId,
      isOperational: false,
      faultReportId,
      faultReportCorrelative,
      createdFaultReport,
      requiresFaultCompletion,
      skippedReason,
    };
  }

  private async findActiveFaultReport(
    tx: Prisma.TransactionClient,
    tenantId: string,
    equipmentId: string,
  ): Promise<{ id: string; correlative: string } | null> {
    const open = await tx.faultReport.findFirst({
      where: {
        tenantId,
        equipmentId,
        status: FaultReportStatus.OPEN,
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, correlative: true },
    });
    if (open) return open;

    const linked = await tx.faultReport.findFirst({
      where: {
        tenantId,
        equipmentId,
        status: FaultReportStatus.LINKED,
        OR: [
          { workOrderId: null },
          {
            workOrder: {
              status: { not: OtStatus.CLOSED },
            },
          },
        ],
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, correlative: true },
    });
    return linked;
  }

  private buildStubSymptom(
    comments: string | null | undefined,
    status: OperationalStatus,
    reportDate: string,
  ): string {
    const trimmed = (comments ?? '').trim();
    if (trimmed.length >= 10) {
      return trimmed;
    }
    const label =
      status === OperationalStatus.DOWN_FAILURE
        ? 'Detenido por Falla'
        : 'Detenido por Mantenimiento';
    const suffix = trimmed ? ` Observación: ${trimmed}` : '';
    return `Declarado en parte M2 (${label}) — turno ${reportDate}.${suffix}`;
  }

  private resolveEventDate(reportDateIso: string): Date {
    const d = new Date(reportDateIso);
    if (!Number.isNaN(d.getTime())) {
      d.setUTCHours(12, 0, 0, 0);
      return d;
    }
    return new Date();
  }
}
