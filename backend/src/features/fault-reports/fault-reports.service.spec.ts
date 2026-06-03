import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import {
  AffectedSystem,
  FaultCriticality,
  FaultReportStatus,
  Prisma,
} from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { SequenceService } from '../../common/sequence/sequence.service';
import { StorageService } from '../../common/storage/storage.service';
import { NotificationDispatcherService } from '../../common/notifications/notification-dispatcher.service';
import { FaultReportsService } from './fault-reports.service';
import { CreateFaultReportDto } from './dto/create-fault-report.dto';

/** Espera a que se vacíen las microtareas pendientes (dispatch fire-and-forget). */
const flushAsync = () => new Promise((resolve) => setImmediate(resolve));

// ── Mock del helper de horómetro (patrón estándar del proyecto) ──────────────
jest.mock('../equipments/equipment-meter-sync', () => ({
  applyCurrentMeterChange: jest.fn().mockResolvedValue(undefined),
}));

import { applyCurrentMeterChange } from '../equipments/equipment-meter-sync';

const mockApplyCurrentMeterChange = jest.mocked(applyCurrentMeterChange);

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures reutilizables
// ─────────────────────────────────────────────────────────────────────────────
const tenantId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const contractId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const equipmentId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const userId = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const reportId = '11111111-1111-1111-1111-111111111111';
const workOrderId = '22222222-2222-2222-2222-222222222222';

const operatorUser = { id: userId, tenantId, role: 'USER' };

/** Equipo válido con contrato asignado y horómetro actual = 1000 h */
const validEquipment = {
  id: equipmentId,
  tenantId,
  contractId,
  subcontractId: null,
  currentMeter: 1000,
};

/** Equipo sin contrato asignado */
const equipmentWithoutContract = {
  ...validEquipment,
  contractId: null,
};

/** OT generada simulando el retorno de tx.workOrder.create */
const createdWorkOrder = {
  id: workOrderId,
  tenantId,
  correlative: 'OT-2026-006',
  equipmentId,
  status: 'OPEN',
  category: 'NO_PROGRAMADA_REACTIVA',
};

/** Reporte creado en estado OPEN (retorno de tx.faultReport.create) */
const createdReport = {
  id: reportId,
  tenantId,
  contractId,
  equipmentId,
  reportedById: userId,
  correlative: 'RF-00001',
  eventDate: new Date('2026-06-02T14:00:00Z'),
  meterAtFault: null,
  affectedSystem: AffectedSystem.MOTOR,
  criticality: FaultCriticality.LOW,
  symptomDescription: 'Humo negro visible en el escape del equipo.',
  status: FaultReportStatus.OPEN,
  workOrderId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

/** Reporte actualizado a LINKED (retorno de tx.faultReport.update) */
const linkedReport = {
  ...createdReport,
  workOrderId,
  status: FaultReportStatus.LINKED,
};

/** DTO mínimo válido para una falla BAJA */
function buildDto(
  overrides: Partial<CreateFaultReportDto> = {},
): CreateFaultReportDto {
  return {
    equipmentId,
    eventDate: '2026-06-02T14:00:00Z',
    affectedSystem: AffectedSystem.MOTOR,
    criticality: FaultCriticality.LOW,
    symptomDescription: 'Humo negro visible en el escape del equipo.',
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite: create
// ─────────────────────────────────────────────────────────────────────────────
describe('FaultReportsService — create', () => {
  let service: FaultReportsService;
  let prisma: DeepMockProxy<PrismaService>;
  let tx: DeepMockProxy<Prisma.TransactionClient>;
  let sequenceService: { getNextCorrelative: jest.Mock };
  let dispatcher: { dispatch: jest.Mock };

  beforeEach(async () => {
    prisma = mockDeep<PrismaService>();
    tx = mockDeep<Prisma.TransactionClient>();
    mockApplyCurrentMeterChange.mockClear();

    sequenceService = {
      getNextCorrelative: jest.fn().mockResolvedValue('RF-00001'),
    };
    dispatcher = { dispatch: jest.fn().mockResolvedValue(undefined) };

    // Por defecto, sin equipo enriquecido → notifyEquipmentDown retorna temprano.
    prisma.equipment.findUnique.mockResolvedValue(null as never);

    // Patrón estándar: $transaction delega al callback con el tx mock
    prisma.$transaction.mockImplementation(async (fn) =>
      (fn as (client: typeof tx) => Promise<unknown>)(tx),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FaultReportsService,
        { provide: PrismaService, useValue: prisma },
        { provide: SequenceService, useValue: sequenceService },
        { provide: StorageService, useValue: mockDeep<StorageService>() },
        { provide: NotificationDispatcherService, useValue: dispatcher },
        { provide: ConfigService, useValue: { get: jest.fn(() => '') } },
      ],
    }).compile();

    service = module.get(FaultReportsService);
  });

  // ── TEST 1: Falla BAJA — solo registra el reporte, sin OT ni efecto disponibilidad ──

  it('falla BAJA: crea el reporte en estado OPEN sin crear OT ni modificar isOperational', async () => {
    tx.equipment.findFirst.mockResolvedValue(validEquipment as never);
    tx.faultReport.create.mockResolvedValue(createdReport as never);

    const result = await service.create(buildDto(), operatorUser);

    // El reporte fue creado con estado OPEN
    expect(result.id).toBe(reportId);
    expect(result.status).toBe(FaultReportStatus.OPEN);
    expect(result.workOrderId).toBeNull();

    // NO debe crear una OT
    expect(tx.workOrder.create).not.toHaveBeenCalled();
    expect(tx.workOrder.count).not.toHaveBeenCalled();

    // NO debe modificar isOperational del equipo
    expect(tx.equipment.update).not.toHaveBeenCalled();

    // NO debe llamar al helper de horómetro (sin meterAtFault)
    expect(mockApplyCurrentMeterChange).not.toHaveBeenCalled();
  });

  // ── TEST 2: Falla ALTA — crea OT Reactiva, marca equipo fuera de servicio ──

  it('falla ALTA: crea OT NO_PROGRAMADA_REACTIVA y pone isOperational=false', async () => {
    tx.equipment.findFirst.mockResolvedValue(validEquipment as never);
    tx.faultReport.create.mockResolvedValue({
      ...createdReport,
      criticality: FaultCriticality.HIGH,
    } as never);
    tx.workOrder.count.mockResolvedValue(5 as never);
    tx.workOrder.create.mockResolvedValue(createdWorkOrder as never);
    tx.faultReport.update.mockResolvedValue(linkedReport as never);
    tx.equipment.update.mockResolvedValue({} as never);

    const result = await service.create(
      buildDto({ criticality: FaultCriticality.HIGH }),
      operatorUser,
    );

    // El reporte quedó en LINKED con workOrderId asignado
    expect(result.status).toBe(FaultReportStatus.LINKED);
    expect(result.workOrderId).toBe(workOrderId);

    // Creó la OT con la categoría correcta
    expect(tx.workOrder.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          category: 'NO_PROGRAMADA_REACTIVA',
          maintenanceType: 'CORRECTIVO',
          affectsAvailability: 'SI',
          detentionStartedAt: expect.any(Date),
        }),
      }),
    );

    // Actualizó el equipo a fuera de servicio
    expect(tx.equipment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: equipmentId },
        data: { isOperational: false },
      }),
    );
  });

  // ── TEST 3: Falla MEDIA — crea OT Correctiva sin afectar disponibilidad ──

  it('falla MEDIA: crea OT NO_PROGRAMADA_CORRECTIVA sin marcar isOperational=false', async () => {
    tx.equipment.findFirst.mockResolvedValue(validEquipment as never);
    tx.faultReport.create.mockResolvedValue({
      ...createdReport,
      criticality: FaultCriticality.MEDIUM,
    } as never);
    tx.workOrder.count.mockResolvedValue(3 as never);
    tx.workOrder.create.mockResolvedValue({
      ...createdWorkOrder,
      category: 'NO_PROGRAMADA_CORRECTIVA',
    } as never);
    tx.faultReport.update.mockResolvedValue(linkedReport as never);

    await service.create(
      buildDto({ criticality: FaultCriticality.MEDIUM }),
      operatorUser,
    );

    // OT con categoría MEDIA (CORRECTIVA)
    expect(tx.workOrder.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          category: 'NO_PROGRAMADA_CORRECTIVA',
          affectsAvailability: 'NO',
        }),
      }),
    );

    // NO debe haber puesto el equipo fuera de servicio
    expect(tx.equipment.update).not.toHaveBeenCalled();
  });

  // ── TEST 4: Horómetro — actualiza si es mayor al actual ──

  it('horómetro: llama a applyCurrentMeterChange cuando meterAtFault > currentMeter', async () => {
    const meterAtFault = 1200;
    tx.equipment.findFirst.mockResolvedValue(validEquipment as never); // currentMeter = 1000
    tx.faultReport.create.mockResolvedValue({
      ...createdReport,
      meterAtFault,
    } as never);

    await service.create(buildDto({ meterAtFault }), operatorUser);

    expect(mockApplyCurrentMeterChange).toHaveBeenCalledTimes(1);
    expect(mockApplyCurrentMeterChange).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        oldMeter: 1000,
        newMeter: 1200,
        source: 'FAULT_REPORT',
      }),
    );
  });

  // ── TEST 5: Horómetro — ignora silenciosamente si es menor o igual ──

  it('horómetro: no actualiza si meterAtFault <= currentMeter', async () => {
    tx.equipment.findFirst.mockResolvedValue(validEquipment as never); // currentMeter = 1000
    tx.faultReport.create.mockResolvedValue(createdReport as never);

    await service.create(buildDto({ meterAtFault: 900 }), operatorUser);

    expect(mockApplyCurrentMeterChange).not.toHaveBeenCalled();
  });

  // ── TEST 6: Error — equipo no encontrado ──

  it('lanza NotFoundException si el equipo no pertenece al tenant', async () => {
    tx.equipment.findFirst.mockResolvedValue(null as never);

    await expect(service.create(buildDto(), operatorUser)).rejects.toThrow(
      NotFoundException,
    );

    expect(tx.faultReport.create).not.toHaveBeenCalled();
  });

  // ── TEST 7: Error — equipo sin contrato asignado ──

  it('lanza BadRequestException si el equipo no tiene contrato asignado', async () => {
    tx.equipment.findFirst.mockResolvedValue(equipmentWithoutContract as never);

    await expect(service.create(buildDto(), operatorUser)).rejects.toThrow(
      BadRequestException,
    );
  });

  // ── TEST 8: Falla ALTA — intervenedSystemsJson refleja el sistema afectado ──

  it('falla ALTA: la OT incluye intervenedSystemsJson con el sistema afectado', async () => {
    tx.equipment.findFirst.mockResolvedValue(validEquipment as never);
    tx.faultReport.create.mockResolvedValue({
      ...createdReport,
      criticality: FaultCriticality.HIGH,
      affectedSystem: AffectedSystem.HYDRAULIC,
    } as never);
    tx.workOrder.count.mockResolvedValue(0 as never);
    tx.workOrder.create.mockResolvedValue(createdWorkOrder as never);
    tx.faultReport.update.mockResolvedValue(linkedReport as never);
    tx.equipment.update.mockResolvedValue({} as never);

    await service.create(
      buildDto({
        criticality: FaultCriticality.HIGH,
        affectedSystem: AffectedSystem.HYDRAULIC,
      }),
      operatorUser,
    );

    expect(tx.workOrder.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          intervenedSystemsJson: [AffectedSystem.HYDRAULIC],
        }),
      }),
    );
  });

  // ── TEST 9: Dispatch EQUIPMENT_DOWN — se llama para falla ALTA ──

  it('falla ALTA: dispara EQUIPMENT_DOWN (fire-and-forget) al completar la transacción', async () => {
    tx.equipment.findFirst.mockResolvedValue(validEquipment as never);
    tx.faultReport.create.mockResolvedValue({
      ...createdReport,
      criticality: FaultCriticality.HIGH,
    } as never);
    tx.workOrder.count.mockResolvedValue(0 as never);
    tx.workOrder.create.mockResolvedValue(createdWorkOrder as never);
    tx.faultReport.update.mockResolvedValue({
      ...linkedReport,
      criticality: FaultCriticality.HIGH,
    } as never);
    tx.equipment.update.mockResolvedValue({} as never);

    // Enriquecimiento post-transacción: equipo + reporter
    prisma.equipment.findUnique.mockResolvedValue({
      internalId: 'EC-3005',
      brand: 'Caterpillar',
      model: '980G',
      contract: { name: 'Contrato Norte' },
    } as never);
    prisma.user.findUnique.mockResolvedValue({ name: 'Juan', email: 'juan@tpm.cl', isActive: true } as never);
    prisma.workOrder.findUnique.mockResolvedValue({ correlative: 'OT-2026-001' } as never);
    prisma.user.findMany.mockResolvedValue([{ id: userId }] as never);

    await service.create(
      buildDto({ criticality: FaultCriticality.HIGH }),
      operatorUser,
    );
    await flushAsync();

    expect(dispatcher.dispatch).toHaveBeenCalledWith(
      'EQUIPMENT_DOWN',
      tenantId,
      expect.objectContaining({
        pushPayload: expect.objectContaining({ data: expect.objectContaining({ type: 'EQUIPMENT_DOWN' }) }),
      }),
    );
  });

  // ── TEST 10: Dispatch EQUIPMENT_DOWN — NO se llama para MEDIA ──

  it('falla MEDIA: no dispara EQUIPMENT_DOWN', async () => {
    tx.equipment.findFirst.mockResolvedValue(validEquipment as never);
    tx.faultReport.create.mockResolvedValue({
      ...createdReport,
      criticality: FaultCriticality.MEDIUM,
    } as never);
    tx.workOrder.count.mockResolvedValue(0 as never);
    tx.workOrder.create.mockResolvedValue(createdWorkOrder as never);
    tx.faultReport.update.mockResolvedValue(linkedReport as never);

    await service.create(
      buildDto({ criticality: FaultCriticality.MEDIUM }),
      operatorUser,
    );
    await flushAsync();

    expect(dispatcher.dispatch).not.toHaveBeenCalled();
  });

  // ── TEST 11: Dispatch EQUIPMENT_DOWN — NO se llama para BAJA ──

  it('falla BAJA: no dispara EQUIPMENT_DOWN', async () => {
    tx.equipment.findFirst.mockResolvedValue(validEquipment as never);
    tx.faultReport.create.mockResolvedValue(createdReport as never);

    await service.create(buildDto({ criticality: FaultCriticality.LOW }), operatorUser);
    await flushAsync();

    expect(dispatcher.dispatch).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite: createWorkOrderFromReport
// ─────────────────────────────────────────────────────────────────────────────
describe('FaultReportsService — createWorkOrderFromReport', () => {
  let service: FaultReportsService;
  let prisma: DeepMockProxy<PrismaService>;
  let tx: DeepMockProxy<Prisma.TransactionClient>;
  let sequenceService: { getNextCorrelative: jest.Mock };
  let dispatcher: { dispatch: jest.Mock };

  const openLowReport = {
    id: reportId,
    status: FaultReportStatus.OPEN,
    criticality: FaultCriticality.LOW,
    equipmentId,
    symptomDescription: 'Vibración anormal en eje trasero.',
    affectedSystem: AffectedSystem.POWER_TRAIN,
    meterAtFault: null,
    equipment: { currentMeter: 1500, subcontractId: null },
  };

  beforeEach(async () => {
    prisma = mockDeep<PrismaService>();
    tx = mockDeep<Prisma.TransactionClient>();

    sequenceService = { getNextCorrelative: jest.fn() };
    dispatcher = { dispatch: jest.fn().mockResolvedValue(undefined) };

    prisma.$transaction.mockImplementation(async (fn) =>
      (fn as (client: typeof tx) => Promise<unknown>)(tx),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FaultReportsService,
        { provide: PrismaService, useValue: prisma },
        { provide: SequenceService, useValue: sequenceService },
        { provide: StorageService, useValue: mockDeep<StorageService>() },
        { provide: NotificationDispatcherService, useValue: dispatcher },
        { provide: ConfigService, useValue: { get: jest.fn(() => '') } },
      ],
    }).compile();

    service = module.get(FaultReportsService);
  });

  it('escala reporte LOW a OT correctiva y pasa el estado a LINKED', async () => {
    prisma.faultReport.findFirst.mockResolvedValue(openLowReport as never);
    tx.workOrder.count.mockResolvedValue(2 as never);
    tx.workOrder.create.mockResolvedValue({ id: workOrderId } as never);
    tx.faultReport.update.mockResolvedValue({
      ...openLowReport,
      workOrderId,
      status: FaultReportStatus.LINKED,
    } as never);

    const result = await service.createWorkOrderFromReport(
      reportId,
      operatorUser,
    );

    expect(tx.workOrder.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          category: 'NO_PROGRAMADA_CORRECTIVA',
          maintenanceType: 'CORRECTIVO',
          affectsAvailability: 'NO',
        }),
      }),
    );
    expect(tx.faultReport.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: FaultReportStatus.LINKED }),
      }),
    );
    expect(result.status).toBe(FaultReportStatus.LINKED);
  });

  it('lanza NotFoundException si el reporte no existe', async () => {
    prisma.faultReport.findFirst.mockResolvedValue(null as never);

    await expect(
      service.createWorkOrderFromReport(reportId, operatorUser),
    ).rejects.toThrow(NotFoundException);
  });

  it('lanza ConflictException si el reporte ya está LINKED', async () => {
    prisma.faultReport.findFirst.mockResolvedValue({
      ...openLowReport,
      status: FaultReportStatus.LINKED,
    } as never);

    await expect(
      service.createWorkOrderFromReport(reportId, operatorUser),
    ).rejects.toThrow(ConflictException);
  });

  it('lanza ConflictException si se intenta escalar un reporte de criticidad ALTA', async () => {
    prisma.faultReport.findFirst.mockResolvedValue({
      ...openLowReport,
      criticality: FaultCriticality.HIGH,
    } as never);

    await expect(
      service.createWorkOrderFromReport(reportId, operatorUser),
    ).rejects.toThrow(ConflictException);
  });
});
