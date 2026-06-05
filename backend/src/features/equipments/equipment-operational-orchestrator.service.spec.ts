import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
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

    const result = await service.onOperationalStatusChange(
      tx,
      buildInput(),
    );

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

    const result = await service.onOperationalStatusChange(
      tx,
      buildInput(),
    );

    expect(result.createdFaultReport).toBe(false);
    expect(result.skippedReason).toBe('ACTIVE_FAULT_EXISTS');
    expect(result.faultReportId).toBe('fr-existing');
    expect(tx.faultReport.create).not.toHaveBeenCalled();
    expect(tx.equipment.update).toHaveBeenCalledWith({
      where: { id: equipmentId },
      data: { isOperational: false },
    });
  });

  it('escenario C: OPERATIONAL tras detención previa restaura isOperational=true', async () => {
    tx.equipment.findFirst.mockResolvedValue({
      ...equipmentRow,
      isOperational: false,
    } as never);
    tx.equipment.update.mockResolvedValue({
      ...equipmentRow,
      isOperational: true,
    } as never);

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

    const result = await service.onOperationalStatusChange(
      tx,
      buildInput(),
    );

    expect(result.skippedReason).toBe('NO_CONTRACT_FOR_STUB');
    expect(result.createdFaultReport).toBe(false);
    expect(result.isOperational).toBe(false);
    expect(tx.faultReport.create).not.toHaveBeenCalled();
  });
});
