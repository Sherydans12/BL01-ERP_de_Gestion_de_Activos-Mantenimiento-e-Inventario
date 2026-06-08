import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import {
  AffectedSystem,
  FaultCriticality,
  FaultReportStatus,
  OperationalStatus,
  Prisma,
} from '@prisma/client';
import { SequenceService } from '../../common/sequence/sequence.service';
import { EquipmentOperationalOrchestratorService } from './equipment-operational-orchestrator.service';
import { OperationalTransitionInput } from './operational-transition.types';

const tenantId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const contractId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const equipmentId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const userId = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const availabilityId = '11111111-1111-1111-1111-111111111111';

const equipmentRow = {
  id: equipmentId,
  contractId,
  isOperational: true,
};

function buildInput(
  overrides: Partial<OperationalTransitionInput> = {},
): OperationalTransitionInput {
  return {
    tenantId,
    equipmentId,
    availabilityId,
    newStatus: OperationalStatus.DOWN_FAILURE,
    previousStatus: null,
    meterReading: 5100,
    comments: 'Pérdida de potencia en terreno.',
    reportDate: '2026-06-05',
    reportedById: userId,
    ...overrides,
  };
}

describe('EquipmentOperationalOrchestratorService', () => {
  let service: EquipmentOperationalOrchestratorService;
  let tx: DeepMockProxy<Prisma.TransactionClient>;
  let sequenceService: { getNextCorrelative: jest.Mock };

  beforeEach(async () => {
    tx = mockDeep<Prisma.TransactionClient>();
    sequenceService = {
      getNextCorrelative: jest.fn().mockResolvedValue('RF-00042'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EquipmentOperationalOrchestratorService,
        { provide: SequenceService, useValue: sequenceService },
      ],
    }).compile();

    service = module.get(EquipmentOperationalOrchestratorService);
    tx.equipment.findFirst.mockResolvedValue(equipmentRow as never);
  });

  it('escenario A: DOWN_FAILURE sin falla previa crea stub OPEN y isOperational=false', async () => {
    tx.faultReport.findFirst
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce(null as never);
    tx.faultReport.create.mockResolvedValue({
      id: 'fr-new',
      correlative: 'RF-00042',
    } as never);
    tx.equipment.update.mockResolvedValue({
      ...equipmentRow,
      isOperational: false,
    } as never);

    const result = await service.onOperationalStatusChange(tx, buildInput());

    expect(result.createdFaultReport).toBe(true);
    expect(result.isOperational).toBe(false);
    expect(result.faultReportId).toBe('fr-new');
    expect(result.faultReportCorrelative).toBe('RF-00042');
    expect(result.requiresFaultCompletion).toBe(true);

    expect(tx.faultReport.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId,
          equipmentId,
          criticality: FaultCriticality.LOW,
          status: FaultReportStatus.OPEN,
          affectedSystem: AffectedSystem.MOTOR,
          symptomDescription: 'Pérdida de potencia en terreno.',
        }),
      }),
    );
    expect(tx.equipment.update).toHaveBeenCalledWith({
      where: { id: equipmentId },
      data: { isOperational: false },
    });
  });

  it('escenario B: DOWN_FAILURE con falla OPEN activa no duplica RF', async () => {
    tx.faultReport.findFirst.mockResolvedValueOnce({
      id: 'fr-existing',
      correlative: 'RF-00001',
    } as never);
    tx.equipment.update.mockResolvedValue({
      ...equipmentRow,
      isOperational: false,
    } as never);

    const result = await service.onOperationalStatusChange(tx, buildInput());

    expect(result.createdFaultReport).toBe(false);
    expect(result.skippedReason).toBe('ACTIVE_FAULT_EXISTS');
    expect(result.faultReportId).toBe('fr-existing');
    expect(tx.faultReport.create).not.toHaveBeenCalled();
    expect(tx.equipment.update).toHaveBeenCalledWith({
      where: { id: equipmentId },
      data: { isOperational: false },
    });
  });

  it('escenario C: OPERATIONAL tras detención previa sin bloqueadores restaura isOperational=true', async () => {
    tx.equipment.findFirst.mockResolvedValue({
      ...equipmentRow,
      isOperational: false,
    } as never);
    tx.equipment.update.mockResolvedValue({
      ...equipmentRow,
      isOperational: true,
    } as never);
    // P0: sin bloqueadores activos
    tx.faultReport.findMany.mockResolvedValue([] as never);
    tx.workOrder.findMany.mockResolvedValue([] as never);

    const result = await service.onOperationalStatusChange(
      tx,
      buildInput({
        newStatus: OperationalStatus.OPERATIONAL,
        previousStatus: OperationalStatus.DOWN_FAILURE,
      }),
    );

    expect(result.isOperational).toBe(true);
    expect(result.createdFaultReport).toBe(false);
    expect(tx.faultReport.create).not.toHaveBeenCalled();
    expect(tx.equipment.update).toHaveBeenCalledWith({
      where: { id: equipmentId },
      data: { isOperational: true },
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // P0 — Bloqueadores operacionales
  // ────────────────────────────────────────────────────────────────────────────

  it('P0: falla HIGH OPEN bloquea reactivación', async () => {
    tx.equipment.findFirst.mockResolvedValue({
      ...equipmentRow,
      isOperational: false,
    } as never);
    tx.faultReport.findMany.mockResolvedValue([
      { id: 'fr-1', correlative: 'RF-00010', status: FaultReportStatus.OPEN },
    ] as never);
    tx.workOrder.findMany.mockResolvedValue([] as never);

    const result = await service.onOperationalStatusChange(
      tx,
      buildInput({
        newStatus: OperationalStatus.OPERATIONAL,
        previousStatus: OperationalStatus.DOWN_FAILURE,
      }),
    );

    expect(result.isOperational).toBe(false);
    expect(result.skippedReason).toBe('BLOCKED_BY_ACTIVE_CAUSES');
    expect(result.blockers).toHaveLength(1);
    expect(result.blockers![0].type).toBe('HIGH_FAULT');
    expect(result.blockers![0].correlative).toBe('RF-00010');

    expect(tx.equipment.update).not.toHaveBeenCalled();
  });

  it('P0: falla HIGH LINKED con OT no cerrada bloquea reactivación', async () => {
    tx.equipment.findFirst.mockResolvedValue({
      ...equipmentRow,
      isOperational: false,
    } as never);
    tx.faultReport.findMany.mockResolvedValue([
      { id: 'fr-2', correlative: 'RF-00020', status: FaultReportStatus.LINKED },
    ] as never);
    tx.workOrder.findMany.mockResolvedValue([] as never);

    const result = await service.onOperationalStatusChange(
      tx,
      buildInput({
        newStatus: OperationalStatus.OPERATIONAL,
        previousStatus: OperationalStatus.DOWN_FAILURE,
      }),
    );

    expect(result.isOperational).toBe(false);
    expect(result.skippedReason).toBe('BLOCKED_BY_ACTIVE_CAUSES');
    expect(result.blockers).toHaveLength(1);
    expect(result.blockers![0].type).toBe('HIGH_FAULT');
  });

  it('P0: OT con affectsAvailability=SI e IN_PROGRESS bloquea reactivación', async () => {
    tx.equipment.findFirst.mockResolvedValue({
      ...equipmentRow,
      isOperational: false,
    } as never);
    tx.faultReport.findMany.mockResolvedValue([] as never);
    tx.workOrder.findMany.mockResolvedValue([
      {
        id: 'wo-1',
        correlative: 'OT-2026-001',
        status: 'IN_PROGRESS',
        affectsAvailability: 'SI',
      },
    ] as never);

    const result = await service.onOperationalStatusChange(
      tx,
      buildInput({
        newStatus: OperationalStatus.OPERATIONAL,
        previousStatus: OperationalStatus.DOWN_MAINTENANCE,
      }),
    );

    expect(result.isOperational).toBe(false);
    expect(result.skippedReason).toBe('BLOCKED_BY_ACTIVE_CAUSES');
    expect(result.blockers).toHaveLength(1);
    expect(result.blockers![0].type).toBe('AVAILABILITY_WORK_ORDER');
    expect(result.blockers![0].correlative).toBe('OT-2026-001');
  });

  it('P0: múltiples bloqueadores retorna todos', async () => {
    tx.equipment.findFirst.mockResolvedValue({
      ...equipmentRow,
      isOperational: false,
    } as never);
    tx.faultReport.findMany.mockResolvedValue([
      { id: 'fr-a', correlative: 'RF-00100', status: FaultReportStatus.OPEN },
    ] as never);
    tx.workOrder.findMany.mockResolvedValue([
      {
        id: 'wo-b',
        correlative: 'OT-2026-050',
        status: 'OPEN',
        affectsAvailability: 'SI',
      },
    ] as never);

    const result = await service.onOperationalStatusChange(
      tx,
      buildInput({
        newStatus: OperationalStatus.OPERATIONAL,
        previousStatus: OperationalStatus.DOWN_FAILURE,
      }),
    );

    expect(result.isOperational).toBe(false);
    expect(result.skippedReason).toBe('BLOCKED_BY_ACTIVE_CAUSES');
    expect(result.blockers).toHaveLength(2);
    const types = result.blockers!.map((b) => b.type);
    expect(types).toContain('HIGH_FAULT');
    expect(types).toContain('AVAILABILITY_WORK_ORDER');
  });

  it('P0: consultas de bloqueadores usan el TransactionClient recibido', async () => {
    tx.equipment.findFirst.mockResolvedValue({
      ...equipmentRow,
      isOperational: false,
    } as never);
    tx.faultReport.findMany.mockResolvedValue([] as never);
    tx.workOrder.findMany.mockResolvedValue([] as never);
    tx.equipment.update.mockResolvedValue({
      ...equipmentRow,
      isOperational: true,
    } as never);

    await service.onOperationalStatusChange(
      tx,
      buildInput({
        newStatus: OperationalStatus.OPERATIONAL,
        previousStatus: OperationalStatus.DOWN_FAILURE,
      }),
    );

    // Las consultas de bloqueadores deben haber usado tx, no otro cliente
    expect(tx.faultReport.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId,
          equipmentId,
        }),
      }),
    );
    expect(tx.workOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId,
          equipmentId,
        }),
      }),
    );
  });

  it('OPERATIONAL sin previousStatus de detención no modifica el equipo', async () => {
    const result = await service.onOperationalStatusChange(
      tx,
      buildInput({
        newStatus: OperationalStatus.OPERATIONAL,
        previousStatus: null,
      }),
    );

    expect(result.skippedReason).toBe('NOT_APPLICABLE_STATUS');
    expect(result.isOperational).toBe(true);
    expect(tx.equipment.update).not.toHaveBeenCalled();
  });

  it('lanza NotFoundException si el equipo no existe', async () => {
    tx.equipment.findFirst.mockResolvedValue(null as never);

    await expect(
      service.onOperationalStatusChange(tx, buildInput()),
    ).rejects.toThrow(NotFoundException);
  });

  it('sin contrato: detiene equipo pero no crea stub', async () => {
    tx.equipment.findFirst.mockResolvedValue({
      id: equipmentId,
      contractId: null,
      isOperational: true,
    } as never);
    tx.faultReport.findFirst
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce(null as never);
    tx.equipment.update.mockResolvedValue({
      id: equipmentId,
      isOperational: false,
    } as never);

    const result = await service.onOperationalStatusChange(tx, buildInput());

    expect(result.skippedReason).toBe('NO_CONTRACT_FOR_STUB');
    expect(result.createdFaultReport).toBe(false);
    expect(result.isOperational).toBe(false);
    expect(tx.faultReport.create).not.toHaveBeenCalled();
  });
});
