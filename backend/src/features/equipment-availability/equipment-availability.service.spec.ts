import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import { OperationalStatus, Prisma, ShiftType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EquipmentAvailabilityService } from './equipment-availability.service';
import { CreateEquipmentAvailabilityDto } from './dto/create-equipment-availability.dto';

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

    // Patrón estándar: $transaction delega al callback con el tx mock
    prisma.$transaction.mockImplementation(async (fn) =>
      (fn as (client: typeof tx) => Promise<unknown>)(tx),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EquipmentAvailabilityService,
        { provide: PrismaService, useValue: prisma },
      ],
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

  it('isAvailable es false para estado DOWN_FAILURE', async () => {
    tx.equipment.findFirst.mockResolvedValue(validEquipment as never);
    tx.equipmentAvailability.create.mockResolvedValue({
      ...createdRecord,
      status: OperationalStatus.DOWN_FAILURE,
    } as never);

    const result = await service.create(
      buildDto({ status: OperationalStatus.DOWN_FAILURE }),
      adminUser,
    );

    expect(result.status).toBe(OperationalStatus.DOWN_FAILURE);
    expect(result.isAvailable).toBe(false);
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
      providers: [
        EquipmentAvailabilityService,
        { provide: PrismaService, useValue: prisma },
      ],
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

    expect(result).toHaveLength(2);
    expect(result.map((e) => e.id)).not.toContain(equipmentId);
    expect(result.map((e) => e.id)).toContain(eq2Id);
    expect(result.map((e) => e.id)).toContain(eq3Id);
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

    expect(result).toHaveLength(0);
  });

  it('retorna toda la flota cuando no hay ningún reporte en el turno', async () => {
    prisma.equipment.findMany.mockResolvedValue(fleetStub as never);
    prisma.equipmentAvailability.findMany.mockResolvedValue([] as never);

    const result = await service.findUnreported(adminUser, {
      date: '2026-06-02',
      shift: ShiftType.NIGHT,
    });

    expect(result).toHaveLength(3);
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
      providers: [
        EquipmentAvailabilityService,
        { provide: PrismaService, useValue: prisma },
      ],
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
});
