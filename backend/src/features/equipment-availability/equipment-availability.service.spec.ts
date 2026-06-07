import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import { OperationalStatus, Prisma, ShiftType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SequenceService } from '../../common/sequence/sequence.service';
import { EquipmentOperationalOrchestratorService } from '../equipments/equipment-operational-orchestrator.service';
import { EquipmentAvailabilityService } from './equipment-availability.service';
import { CreateEquipmentAvailabilityDto } from './dto/create-equipment-availability.dto';
import { ImportAvailabilityCommitDto } from './dto/import-availability-commit.dto';
import ExcelJS from 'exceljs';

// ── Mock del helper de horómetro (mismo patrón que lube-reports.service.spec) ──
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
const availabilityId = '11111111-1111-1111-1111-111111111111';
const eq2Id = '22222222-2222-2222-2222-222222222222';
const eq3Id = '33333333-3333-3333-3333-333333333333';

const adminUser = { id: userId, tenantId, role: 'ADMIN', allowedContracts: [] };
const supervisorUser = {
  id: userId,
  tenantId,
  role: 'USER',
  allowedContracts: [contractId],
};

/** Equipo válido con horómetro actual = 1000 h */
const validEquipment = {
  id: equipmentId,
  tenantId,
  contractId,
  currentMeter: 1000,
};

/** Registro de disponibilidad creado (retorno simulado de tx.equipmentAvailability.create) */
const createdRecord = {
  id: availabilityId,
  tenantId,
  contractId,
  equipmentId,
  reportedById: userId,
  reportDate: new Date('2026-06-02'),
  shift: ShiftType.DAY,
  status: OperationalStatus.OPERATIONAL,
  meterReading: null,
  comments: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function buildDto(
  overrides: Partial<CreateEquipmentAvailabilityDto> = {},
): CreateEquipmentAvailabilityDto {
  return {
    equipmentId,
    reportDate: '2026-06-02',
    shift: ShiftType.DAY,
    status: OperationalStatus.OPERATIONAL,
    ...overrides,
  };
}

function availabilityTestProviders(
  prisma: DeepMockProxy<PrismaService>,
  sequenceService: { getNextCorrelative: jest.Mock },
) {
  return [
    EquipmentAvailabilityService,
    { provide: PrismaService, useValue: prisma },
    EquipmentOperationalOrchestratorService,
    { provide: SequenceService, useValue: sequenceService },
  ];
}

const sequenceServiceStub = {
  getNextCorrelative: jest.fn().mockResolvedValue('RF-00001'),
};

// ─────────────────────────────────────────────────────────────────────────────
// Suite: create
// ─────────────────────────────────────────────────────────────────────────────
describe('EquipmentAvailabilityService — create', () => {
  let service: EquipmentAvailabilityService;
  let prisma: DeepMockProxy<PrismaService>;
  let tx: DeepMockProxy<Prisma.TransactionClient>;

  beforeEach(async () => {
    prisma = mockDeep<PrismaService>();
    tx = mockDeep<Prisma.TransactionClient>();
    mockApplyCurrentMeterChange.mockClear();
    sequenceServiceStub.getNextCorrelative.mockClear();
    sequenceServiceStub.getNextCorrelative.mockResolvedValue('RF-00001');

    prisma.$transaction.mockImplementation(async (fn) =>
      (fn as (client: typeof tx) => Promise<unknown>)(tx),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: availabilityTestProviders(prisma, sequenceServiceStub),
    }).compile();

    service = module.get(EquipmentAvailabilityService);
  });

  // ── (1) HAPPY PATH sin actualizar horómetro ──────────────────────────────
  it('happy path: crea el reporte sin actualizar el horómetro cuando meterReading es omitido', async () => {
    tx.equipment.findFirst.mockResolvedValue(validEquipment as never);
    tx.equipmentAvailability.create.mockResolvedValue(createdRecord as never);

    const result = await service.create(buildDto(), adminUser);

    // El registro fue creado con los datos correctos
    expect(result.id).toBe(availabilityId);
    expect(result.shift).toBe(ShiftType.DAY);
    expect(result.status).toBe(OperationalStatus.OPERATIONAL);

    // isAvailable derivado: OPERATIONAL → true
    expect(result.isAvailable).toBe(true);

    // El horómetro NO debe haber sido tocado
    expect(mockApplyCurrentMeterChange).not.toHaveBeenCalled();

    // Verifica que el create usó el contractId del equipo
    expect(tx.equipmentAvailability.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId,
          equipmentId,
          reportedById: userId,
          contractId,
          shift: ShiftType.DAY,
          status: OperationalStatus.OPERATIONAL,
          meterReading: null,
        }),
      }),
    );
  });

  // ── (2) HAPPY PATH actualizando horómetro ────────────────────────────────
  it('happy path: actualiza el horómetro con AVAILABILITY_REPORT cuando meterReading > currentMeter', async () => {
    tx.equipment.findFirst.mockResolvedValue(validEquipment as never); // currentMeter = 1000
    const recordWithMeter = { ...createdRecord, meterReading: 1200 };
    tx.equipmentAvailability.create.mockResolvedValue(recordWithMeter as never);

    const result = await service.create(
      buildDto({ meterReading: 1200 }),
      adminUser,
    );

    expect(result.meterReading).toBe(1200);

    // applyCurrentMeterChange debe llamarse con source AVAILABILITY_REPORT
    expect(mockApplyCurrentMeterChange).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        tenantId,
        equipmentId,
        oldMeter: 1000,
        newMeter: 1200,
        source: 'AVAILABILITY_REPORT',
        sourceId: availabilityId,
        userId,
      }),
    );
  });

  it('silent ignore: NO actualiza horómetro cuando meterReading <= currentMeter', async () => {
    tx.equipment.findFirst.mockResolvedValue(validEquipment as never); // currentMeter = 1000
    const recordWithLowerMeter = { ...createdRecord, meterReading: 800 };
    tx.equipmentAvailability.create.mockResolvedValue(
      recordWithLowerMeter as never,
    );

    // meterReading=800 < currentMeter=1000 → guarda el reporte, ignora la actualización
    const result = await service.create(
      buildDto({ meterReading: 800 }),
      adminUser,
    );

    expect(result.id).toBe(availabilityId);
    // El horómetro NO se toca — no lanza error, solo ignora
    expect(mockApplyCurrentMeterChange).not.toHaveBeenCalled();
  });

  // ── (3) CONFLICT: duplicado en mismo turno/fecha ─────────────────────────
  it('lanza ConflictException si el equipo ya tiene reporte para este turno y fecha', async () => {
    tx.equipment.findFirst.mockResolvedValue(validEquipment as never);

    // Simula la violación del @@unique que Prisma convierte en P2002
    const p2002 = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed on the fields: (`tenant_id`,`equipment_id`,`report_date`,`shift`)',
      { code: 'P2002', clientVersion: '7.5.0' },
    );
    tx.equipmentAvailability.create.mockRejectedValue(p2002);

    await expect(service.create(buildDto(), adminUser)).rejects.toThrow(
      ConflictException,
    );
    await expect(service.create(buildDto(), adminUser)).rejects.toThrow(
      /ya tiene un reporte para este turno y fecha/,
    );

    // El horómetro no debe haberse tocado
    expect(mockApplyCurrentMeterChange).not.toHaveBeenCalled();
  });

  it('lanza NotFoundException si el equipo no existe en el tenant', async () => {
    tx.equipment.findFirst.mockResolvedValue(null as never);

    await expect(service.create(buildDto(), adminUser)).rejects.toThrow(
      NotFoundException,
    );
    await expect(service.create(buildDto(), adminUser)).rejects.toThrow(
      /no existe o no pertenece a este tenant/,
    );

    // No debe haberse intentado crear el registro
    expect(tx.equipmentAvailability.create).not.toHaveBeenCalled();
  });

  it('isAvailable es false para estado DOWN_FAILURE y orquesta stub M3', async () => {
    tx.equipment.findFirst.mockResolvedValue(validEquipment as never);
    tx.equipmentAvailability.create.mockResolvedValue({
      ...createdRecord,
      status: OperationalStatus.DOWN_FAILURE,
    } as never);
    tx.faultReport.findFirst
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce(null as never);
    tx.faultReport.create.mockResolvedValue({
      id: 'fr-stub-1',
      correlative: 'RF-00001',
    } as never);
    tx.equipment.update.mockResolvedValue({
      ...validEquipment,
      isOperational: false,
    } as never);

    const result = await service.create(
      buildDto({
        status: OperationalStatus.DOWN_FAILURE,
        comments: 'Fuga hidráulica en terreno.',
      }),
      adminUser,
    );

    expect(result.status).toBe(OperationalStatus.DOWN_FAILURE);
    expect(result.isAvailable).toBe(false);
    expect(result.operationalTransition?.createdFaultReport).toBe(true);
    expect(result.operationalTransition?.isOperational).toBe(false);
    expect(result.operationalTransition?.faultReportId).toBe('fr-stub-1');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite: findUnreported
// ─────────────────────────────────────────────────────────────────────────────
describe('EquipmentAvailabilityService — findUnreported', () => {
  let service: EquipmentAvailabilityService;
  let prisma: DeepMockProxy<PrismaService>;

  /** Flota simulada: 3 equipos operativos del tenant */
  const fleetStub = [
    {
      id: equipmentId,
      internalId: 'EQ-001',
      brand: 'CAT',
      model: '330',
      plate: 'A-001',
      contractId,
    },
    {
      id: eq2Id,
      internalId: 'EQ-002',
      brand: 'Komatsu',
      model: 'PC200',
      plate: 'A-002',
      contractId,
    },
    {
      id: eq3Id,
      internalId: 'EQ-003',
      brand: 'Volvo',
      model: 'EC300',
      plate: 'A-003',
      contractId,
    },
  ];

  beforeEach(async () => {
    prisma = mockDeep<PrismaService>();

    const module: TestingModule = await Test.createTestingModule({
      providers: availabilityTestProviders(prisma, sequenceServiceStub),
    }).compile();

    service = module.get(EquipmentAvailabilityService);
  });

  it('retorna los equipos de la flota que NO tienen reporte en el turno indicado', async () => {
    // EQ-001 ya fue reportado; EQ-002 y EQ-003 faltan
    prisma.equipment.findMany.mockResolvedValue(fleetStub as never);
    prisma.equipmentAvailability.findMany.mockResolvedValue([
      { equipmentId },
    ] as never);

    const result = await service.findUnreported(adminUser, {
      date: '2026-06-02',
      shift: ShiftType.DAY,
    });

    expect(result.data).toHaveLength(2);
    expect(result.total).toBe(2);
    expect(result.data.map((e) => e.id)).not.toContain(equipmentId);
    expect(result.data.map((e) => e.id)).toContain(eq2Id);
    expect(result.data.map((e) => e.id)).toContain(eq3Id);
  });

  it('retorna lista vacía cuando todos los equipos han sido reportados', async () => {
    prisma.equipment.findMany.mockResolvedValue(fleetStub as never);
    prisma.equipmentAvailability.findMany.mockResolvedValue(
      fleetStub.map((e) => ({ equipmentId: e.id })) as never,
    );

    const result = await service.findUnreported(adminUser, {
      date: '2026-06-02',
      shift: ShiftType.DAY,
    });

    expect(result.data).toHaveLength(0);
    expect(result.total).toBe(0);
  });

  it('retorna toda la flota cuando no hay ningún reporte en el turno', async () => {
    prisma.equipment.findMany.mockResolvedValue(fleetStub as never);
    prisma.equipmentAvailability.findMany.mockResolvedValue([] as never);

    const result = await service.findUnreported(adminUser, {
      date: '2026-06-02',
      shift: ShiftType.NIGHT,
    });

    expect(result.data).toHaveLength(3);
    expect(result.total).toBe(3);
  });

  it('aplica el filtro contractId explícito en la query de equipos', async () => {
    const otroContractId = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
    prisma.equipment.findMany.mockResolvedValue([] as never);
    prisma.equipmentAvailability.findMany.mockResolvedValue([] as never);

    await service.findUnreported(adminUser, {
      date: '2026-06-02',
      shift: ShiftType.DAY,
      contractId: otroContractId,
    });

    expect(prisma.equipment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId,
          isOperational: true,
          contractId: otroContractId,
        }),
      }),
    );
  });

  it('supervisor: aplica allowedContracts del JWT en el where de equipos', async () => {
    prisma.equipment.findMany.mockResolvedValue([] as never);
    prisma.equipmentAvailability.findMany.mockResolvedValue([] as never);

    await service.findUnreported(supervisorUser, {
      date: '2026-06-02',
      shift: ShiftType.DAY,
    });

    expect(prisma.equipment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId,
          isOperational: true,
          contractId: { in: [contractId] },
        }),
      }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite: findAll
// ─────────────────────────────────────────────────────────────────────────────
describe('EquipmentAvailabilityService — findAll', () => {
  let service: EquipmentAvailabilityService;
  let prisma: DeepMockProxy<PrismaService>;

  const rowStub = {
    id: availabilityId,
    tenantId,
    contractId,
    equipmentId,
    reportedById: userId,
    reportDate: new Date('2026-06-02'),
    shift: ShiftType.DAY,
    status: OperationalStatus.OPERATIONAL,
    meterReading: null,
    comments: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    equipment: {
      id: equipmentId,
      internalId: 'EQ-001',
      brand: 'CAT',
      model: '330',
      plate: 'A-001',
    },
    reportedBy: { id: userId, name: 'Supervisor Turno' },
  };

  beforeEach(async () => {
    prisma = mockDeep<PrismaService>();

    const module: TestingModule = await Test.createTestingModule({
      providers: availabilityTestProviders(prisma, sequenceServiceStub),
    }).compile();

    service = module.get(EquipmentAvailabilityService);
  });

  it('retorna estructura paginada con isAvailable derivado', async () => {
    prisma.equipmentAvailability.findMany.mockResolvedValue([rowStub] as never);
    prisma.equipmentAvailability.count.mockResolvedValue(1);

    const result = await service.findAll(adminUser);

    expect(result).toMatchObject({
      data: expect.any(Array),
      total: 1,
      page: 1,
      pageSize: 25,
    });
    expect(result.data[0].id).toBe(availabilityId);
    // OPERATIONAL → isAvailable = true
    expect(result.data[0].isAvailable).toBe(true);
  });

  it('aplica filtro de turno en el where de Prisma', async () => {
    prisma.equipmentAvailability.findMany.mockResolvedValue([rowStub] as never);
    prisma.equipmentAvailability.count.mockResolvedValue(1);

    await service.findAll(adminUser, { shift: ShiftType.NIGHT });

    expect(prisma.equipmentAvailability.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId, shift: ShiftType.NIGHT }),
      }),
    );
  });

  it('supervisor: filtra historial por allowedContracts vía relación equipment', async () => {
    prisma.equipmentAvailability.findMany.mockResolvedValue([] as never);
    prisma.equipmentAvailability.count.mockResolvedValue(0);

    await service.findAll(supervisorUser);

    expect(prisma.equipmentAvailability.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId,
          equipment: expect.objectContaining({
            contractId: { in: [contractId] },
          }),
        }),
      }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite: getShiftBoard
// ─────────────────────────────────────────────────────────────────────────────
describe('EquipmentAvailabilityService — getShiftBoard', () => {
  let service: EquipmentAvailabilityService;
  let prisma: DeepMockProxy<PrismaService>;

  const fleetStub = [
    {
      id: equipmentId,
      internalId: 'EQ-001',
      brand: 'CAT',
      model: '330',
      plate: 'A-001',
      contractId,
      isOperational: true,
    },
    {
      id: eq2Id,
      internalId: 'EQ-002',
      brand: 'Komatsu',
      model: 'PC200',
      plate: 'A-002',
      contractId,
      isOperational: true,
    },
    {
      id: eq3Id,
      internalId: 'EQ-003',
      brand: 'Volvo',
      model: 'EC300',
      plate: 'A-003',
      contractId,
      isOperational: false,
    },
  ];

  beforeEach(async () => {
    prisma = mockDeep<PrismaService>();
    const module: TestingModule = await Test.createTestingModule({
      providers: availabilityTestProviders(prisma, sequenceServiceStub),
    }).compile();
    service = module.get(EquipmentAvailabilityService);
  });

  it('retorna summary coherente y filas REPORTED/PENDING/EXCLUDED', async () => {
    prisma.equipment.findMany.mockResolvedValue(fleetStub as never);
    prisma.equipmentAvailability.findMany.mockResolvedValue([
      {
        id: availabilityId,
        equipmentId,
        status: OperationalStatus.OPERATIONAL,
        meterReading: 1200,
        comments: null,
        createdAt: new Date('2026-06-02T10:00:00Z'),
        reportedBy: { id: userId, name: 'Supervisor' },
        equipment: fleetStub[0],
      },
    ] as never);

    const result = await service.getShiftBoard(adminUser, {
      date: '2026-06-02',
      shift: ShiftType.DAY,
      tab: 'ALL',
    });

    expect(result.summary).toMatchObject({
      totalFleet: 2,
      reportedCount: 1,
      unreportedCount: 1,
      excludedDownCount: 1,
      completionPct: 50,
    });
    expect(result.rows).toHaveLength(3);
    expect(
      result.rows.find((r) => r.equipmentId === equipmentId)?.rowKind,
    ).toBe('REPORTED');
    expect(result.rows.find((r) => r.equipmentId === eq2Id)?.rowKind).toBe(
      'PENDING',
    );
    expect(result.rows.find((r) => r.equipmentId === eq3Id)?.rowKind).toBe(
      'EXCLUDED',
    );
  });

  it('filtra tab REPORTED antes de paginar', async () => {
    prisma.equipment.findMany.mockResolvedValue(fleetStub as never);
    prisma.equipmentAvailability.findMany.mockResolvedValue([
      {
        id: availabilityId,
        equipmentId,
        status: OperationalStatus.STANDBY,
        meterReading: null,
        comments: null,
        createdAt: new Date(),
        reportedBy: { id: userId, name: 'Supervisor' },
        equipment: fleetStub[0],
      },
    ] as never);

    const result = await service.getShiftBoard(adminUser, {
      date: '2026-06-02',
      shift: ShiftType.DAY,
      tab: 'REPORTED',
    });

    expect(result.total).toBe(1);
    expect(result.rows.every((r) => r.rowKind === 'REPORTED')).toBe(true);
    expect(result.summary.byStatus.STANDBY).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite: batchCreate
// ─────────────────────────────────────────────────────────────────────────────
describe('EquipmentAvailabilityService — batchCreate', () => {
  let service: EquipmentAvailabilityService;
  let prisma: DeepMockProxy<PrismaService>;
  let tx: DeepMockProxy<Prisma.TransactionClient>;

  beforeEach(async () => {
    prisma = mockDeep<PrismaService>();
    tx = mockDeep<Prisma.TransactionClient>();
    prisma.$transaction.mockImplementation(async (fn) =>
      (fn as (client: typeof tx) => Promise<unknown>)(tx),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: availabilityTestProviders(prisma, sequenceServiceStub),
    }).compile();
    service = module.get(EquipmentAvailabilityService);
  });

  it('persiste filas válidas y acumula errores por fila fallida', async () => {
    tx.equipment.findFirst
      .mockResolvedValueOnce(validEquipment as never)
      .mockResolvedValueOnce(validEquipment as never)
      .mockRejectedValueOnce(new NotFoundException('Equipo no encontrado'));
    tx.equipmentAvailability.findUnique.mockResolvedValue(null as never);
    tx.equipmentAvailability.upsert.mockResolvedValue(createdRecord as never);

    const result = await service.batchCreate(
      {
        reportDate: '2026-06-02',
        shift: ShiftType.DAY,
        rows: [
          { equipmentId, status: OperationalStatus.OPERATIONAL },
          { equipmentId: eq2Id, status: OperationalStatus.DOWN_FAILURE },
        ],
      },
      adminUser,
    );

    expect(result.committed).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].equipmentId).toBe(eq2Id);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite: commitImport
// ─────────────────────────────────────────────────────────────────────────────
describe('EquipmentAvailabilityService — commitImport', () => {
  let service: EquipmentAvailabilityService;
  let prisma: DeepMockProxy<PrismaService>;
  let tx: DeepMockProxy<Prisma.TransactionClient>;

  const upsertedRecord = {
    id: availabilityId,
    tenantId,
    contractId,
    equipmentId,
    reportedById: userId,
    reportDate: new Date('2026-06-02'),
    shift: ShiftType.DAY,
    status: OperationalStatus.OPERATIONAL,
    meterReading: null,
    comments: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const baseDtoTwoRows: ImportAvailabilityCommitDto = {
    reportDate: '2026-06-02',
    shift: ShiftType.DAY,
    rows: [
      { equipmentId, status: OperationalStatus.OPERATIONAL },
      { equipmentId: eq2Id, status: OperationalStatus.STANDBY },
    ],
  };

  beforeEach(async () => {
    prisma = mockDeep<PrismaService>();
    tx = mockDeep<Prisma.TransactionClient>();
    mockApplyCurrentMeterChange.mockClear();

    prisma.$transaction.mockImplementation(async (fn) =>
      (fn as (client: typeof tx) => Promise<unknown>)(tx),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: availabilityTestProviders(prisma, sequenceServiceStub),
    }).compile();

    service = module.get(EquipmentAvailabilityService);
  });

  it('happy path: guarda todas las filas y retorna committed=2 con errores vacíos', async () => {
    tx.equipment.findFirst.mockResolvedValue(validEquipment as never);
    tx.equipmentAvailability.findUnique.mockResolvedValue(null as never);
    tx.equipmentAvailability.upsert.mockResolvedValue(upsertedRecord as never);

    const result = await service.commitImport(baseDtoTwoRows, adminUser);

    expect(result.committed).toBe(2);
    expect(result.errors).toHaveLength(0);
    expect(tx.equipmentAvailability.upsert).toHaveBeenCalledTimes(2);
  });

  it('restaura isOperational=true cuando un parte OPERATIONAL sigue al último M2 DOWN previo', async () => {
    tx.equipment.findFirst.mockResolvedValue({
      ...validEquipment,
      isOperational: false,
    } as never);
    tx.equipmentAvailability.findUnique.mockResolvedValue(null as never);
    tx.equipmentAvailability.findFirst.mockResolvedValue({
      status: OperationalStatus.DOWN_FAILURE,
    } as never);
    tx.equipmentAvailability.upsert.mockResolvedValue({
      ...upsertedRecord,
      reportDate: new Date('2026-06-03'),
      status: OperationalStatus.OPERATIONAL,
    } as never);
    tx.equipment.update.mockResolvedValue({
      ...validEquipment,
      isOperational: true,
    } as never);

    const result = await service.commitImport(
      {
        reportDate: '2026-06-03',
        shift: ShiftType.DAY,
        rows: [{ equipmentId, status: OperationalStatus.OPERATIONAL }],
      },
      adminUser,
    );

    expect(result.committed).toBe(1);
    expect(result.errors).toHaveLength(0);
    expect(tx.equipmentAvailability.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId,
          equipmentId,
          reportDate: { lt: new Date('2026-06-03') },
        }),
      }),
    );
    expect(tx.equipment.update).toHaveBeenCalledWith({
      where: { id: equipmentId },
      data: { isOperational: true },
    });
    expect(result.sideEffects?.[0]).toEqual(
      expect.objectContaining({
        equipmentId,
        status: OperationalStatus.OPERATIONAL,
        isOperational: true,
      }),
    );
  });

  it('éxito parcial: guarda la primera fila y reporta el error de la segunda sin abortar el lote', async () => {
    tx.equipment.findFirst
      .mockResolvedValueOnce(validEquipment as never)
      .mockResolvedValueOnce(validEquipment as never)
      .mockResolvedValueOnce(null as never);
    tx.equipmentAvailability.findUnique.mockResolvedValue(null as never);
    tx.equipmentAvailability.upsert.mockResolvedValue(upsertedRecord as never);

    const result = await service.commitImport(baseDtoTwoRows, adminUser);

    expect(result.committed).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].equipmentId).toBe(eq2Id);
    expect(result.errors[0].reason).toMatch(
      /no existe o no pertenece a este tenant/,
    );
  });

  it('avanza el horómetro vía AVAILABILITY_REPORT cuando meterReading > currentMeter', async () => {
    tx.equipment.findFirst.mockResolvedValue({
      ...validEquipment,
      currentMeter: 1000,
    } as never);
    tx.equipmentAvailability.findUnique.mockResolvedValue(null as never);
    tx.equipmentAvailability.upsert.mockResolvedValue({
      ...upsertedRecord,
      meterReading: 1350,
    } as never);

    await service.commitImport(
      {
        reportDate: '2026-06-02',
        shift: ShiftType.DAY,
        rows: [
          {
            equipmentId,
            status: OperationalStatus.OPERATIONAL,
            meterReading: 1350,
          },
        ],
      },
      adminUser,
    );

    expect(mockApplyCurrentMeterChange).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        tenantId,
        equipmentId,
        oldMeter: 1000,
        newMeter: 1350,
        source: 'AVAILABILITY_REPORT',
      }),
    );
  });

  it('silent-skip: NO llama a applyCurrentMeterChange cuando meterReading <= currentMeter', async () => {
    tx.equipment.findFirst.mockResolvedValue({
      ...validEquipment,
      currentMeter: 1500,
    } as never);
    tx.equipmentAvailability.upsert.mockResolvedValue({
      ...upsertedRecord,
      meterReading: 900,
    } as never);

    const result = await service.commitImport(
      {
        reportDate: '2026-06-02',
        shift: ShiftType.DAY,
        rows: [
          {
            equipmentId,
            status: OperationalStatus.OPERATIONAL,
            meterReading: 900,
          },
        ],
      },
      adminUser,
    );

    expect(result.committed).toBe(1);
    expect(result.errors).toHaveLength(0);
    expect(mockApplyCurrentMeterChange).not.toHaveBeenCalled();
  });

  it('retorna committed=0 y todos como errores cuando ningún equipo pertenece al tenant', async () => {
    tx.equipment.findFirst.mockResolvedValue(null as never);

    const result = await service.commitImport(baseDtoTwoRows, adminUser);

    expect(result.committed).toBe(0);
    expect(result.errors).toHaveLength(2);
    expect(tx.equipmentAvailability.upsert).not.toHaveBeenCalled();
    expect(mockApplyCurrentMeterChange).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite: resolveShift — guard hasNightShift=false
// ─────────────────────────────────────────────────────────────────────────────
describe('EquipmentAvailabilityService — hasNightShift guard (create / findUnreported / commitImport)', () => {
  let service: EquipmentAvailabilityService;
  let prisma: DeepMockProxy<PrismaService>;
  let tx: DeepMockProxy<Prisma.TransactionClient>;

  const nightShiftDisabledConfig = {
    hasNightShift: false,
    dayShiftStartTime: '08:00',
    nightShiftStartTime: '20:00',
  };

  beforeEach(async () => {
    prisma = mockDeep<PrismaService>();
    tx = mockDeep<Prisma.TransactionClient>();
    mockApplyCurrentMeterChange.mockClear();

    prisma.$transaction.mockImplementation(async (fn) =>
      (fn as (client: typeof tx) => Promise<unknown>)(tx),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: availabilityTestProviders(prisma, sequenceServiceStub),
    }).compile();

    service = module.get(EquipmentAvailabilityService);
  });

  // ── create() ─────────────────────────────────────────────────────────────

  it('create: acepta shift=DAY aunque hasNightShift=false (siempre permitido)', async () => {
    prisma.tenantOperationalConfig.findUnique.mockResolvedValue(
      nightShiftDisabledConfig as never,
    );
    tx.equipment.findFirst.mockResolvedValue(validEquipment as never);
    tx.equipmentAvailability.create.mockResolvedValue(createdRecord as never);

    const result = await service.create(
      buildDto({ shift: ShiftType.DAY }),
      adminUser,
    );

    expect(result.shift).toBe(ShiftType.DAY);
  });

  it('create: normaliza shift=NIGHT a DAY cuando hasNightShift=false', async () => {
    prisma.tenantOperationalConfig.findUnique.mockResolvedValue(
      nightShiftDisabledConfig as never,
    );
    tx.equipment.findFirst.mockResolvedValue(validEquipment as never);
    tx.equipmentAvailability.create.mockResolvedValue(createdRecord as never);

    await service.create(buildDto({ shift: ShiftType.NIGHT }), adminUser);

    expect(tx.equipmentAvailability.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ shift: ShiftType.DAY }),
      }),
    );
  });

  it('create: defaults shift=DAY cuando no se envía y hasNightShift=false', async () => {
    prisma.tenantOperationalConfig.findUnique.mockResolvedValue(
      nightShiftDisabledConfig as never,
    );
    tx.equipment.findFirst.mockResolvedValue(validEquipment as never);
    tx.equipmentAvailability.create.mockResolvedValue(createdRecord as never);

    // shift omitido en el DTO
    const dto = buildDto();
    delete (dto as Partial<typeof dto>).shift;
    await service.create(dto, adminUser);

    expect(tx.equipmentAvailability.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ shift: ShiftType.DAY }),
      }),
    );
  });

  // ── findUnreported() ──────────────────────────────────────────────────────

  it('findUnreported: normaliza shift=NIGHT a DAY cuando hasNightShift=false', async () => {
    prisma.tenantOperationalConfig.findUnique.mockResolvedValue(
      nightShiftDisabledConfig as never,
    );
    prisma.equipment.findMany.mockResolvedValue([] as never);
    prisma.equipmentAvailability.findMany.mockResolvedValue([] as never);

    await service.findUnreported(adminUser, {
      date: '2026-06-02',
      shift: ShiftType.NIGHT,
    });

    expect(prisma.equipmentAvailability.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ shift: ShiftType.DAY }),
      }),
    );
  });

  it('findUnreported: defaults shift=DAY cuando no se envía y hasNightShift=false', async () => {
    prisma.tenantOperationalConfig.findUnique.mockResolvedValue(
      nightShiftDisabledConfig as never,
    );
    prisma.equipment.findMany.mockResolvedValue([] as never);
    prisma.equipmentAvailability.findMany.mockResolvedValue([] as never);

    await service.findUnreported(adminUser, { date: '2026-06-02' });

    expect(prisma.equipmentAvailability.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ shift: ShiftType.DAY }),
      }),
    );
  });

  // ── commitImport() ────────────────────────────────────────────────────────

  it('commitImport: normaliza shift=NIGHT a DAY cuando hasNightShift=false', async () => {
    prisma.tenantOperationalConfig.findUnique.mockResolvedValue(
      nightShiftDisabledConfig as never,
    );
    tx.equipment.findFirst.mockResolvedValue(validEquipment as never);
    tx.equipmentAvailability.upsert.mockResolvedValue({
      ...validEquipment,
      id: availabilityId,
      status: OperationalStatus.OPERATIONAL,
      shift: ShiftType.DAY,
    } as never);

    await service.commitImport(
      {
        reportDate: '2026-06-02',
        shift: ShiftType.NIGHT,
        rows: [{ equipmentId, status: OperationalStatus.OPERATIONAL }],
      },
      adminUser,
    );

    expect(tx.equipmentAvailability.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId_equipmentId_reportDate_shift: expect.objectContaining({
            shift: ShiftType.DAY,
          }),
        }),
      }),
    );
  });

  it('commitImport: defaults shift=DAY cuando no se envía y hasNightShift=false', async () => {
    prisma.tenantOperationalConfig.findUnique.mockResolvedValue(
      nightShiftDisabledConfig as never,
    );
    tx.equipment.findFirst.mockResolvedValue(validEquipment as never);
    tx.equipmentAvailability.upsert.mockResolvedValue({
      ...validEquipment,
      id: availabilityId,
      reportedById: userId,
      reportDate: new Date('2026-06-02'),
      shift: ShiftType.DAY,
      status: OperationalStatus.OPERATIONAL,
      meterReading: null,
      comments: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    // shift omitido
    const result = await service.commitImport(
      {
        reportDate: '2026-06-02',
        rows: [{ equipmentId, status: OperationalStatus.OPERATIONAL }],
      },
      adminUser,
    );

    expect(result.committed).toBe(1);
    expect(tx.equipmentAvailability.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId_equipmentId_reportDate_shift: expect.objectContaining({
            shift: ShiftType.DAY,
          }),
        }),
      }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite: exportTemplate — plantilla Excel M2
// ─────────────────────────────────────────────────────────────────────────────
describe('EquipmentAvailabilityService — exportTemplate', () => {
  let service: EquipmentAvailabilityService;
  let prisma: DeepMockProxy<PrismaService>;

  const opConfig = {
    hasNightShift: true,
    dayShiftStartTime: '08:00',
    nightShiftStartTime: '20:00',
  };

  beforeEach(async () => {
    prisma = mockDeep<PrismaService>();

    const module: TestingModule = await Test.createTestingModule({
      providers: availabilityTestProviders(prisma, sequenceServiceStub),
    }).compile();

    service = module.get(EquipmentAvailabilityService);

    prisma.tenantOperationalConfig.findUnique.mockResolvedValue(
      opConfig as never,
    );
    prisma.equipment.findMany.mockResolvedValue([
      {
        id: equipmentId,
        internalId: 'EQ-001',
        brand: 'Cat',
        model: '793',
        plate: 'ABCD12',
        currentMeter: 1000,
        meterType: 'HOURS',
      },
    ] as never);
    prisma.equipmentAvailability.findMany.mockResolvedValue([] as never);
    prisma.equipmentMeterLog.findMany.mockResolvedValue([] as never);
  });

  it('genera .xlsx con nombre de hoja válido cuando dayShiftStartTime incluye ":"', async () => {
    const buffer = await service.exportTemplate(
      { reportDate: '2026-06-04', shift: ShiftType.DAY },
      adminUser,
    );

    expect(buffer.length).toBeGreaterThan(0);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(
      buffer as unknown as Parameters<typeof workbook.xlsx.load>[0],
    );

    expect(workbook.worksheets[0]?.name).toBe('Disponibilidad Día (08-00)');
    expect(workbook.getWorksheet('_info')).toBeDefined();
  });
});
