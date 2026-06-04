import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SequenceService } from '../../common/sequence/sequence.service';
import { LubeReportsService } from './lube-reports.service';
import { CreateLubeReportDto } from './dto/create-lube-report.dto';
import { InventoryStockService } from '../inventory-stock/inventory-stock.service';

// ── Mock del helper de horómetro (patrón establecido en work-orders y equipments) ──
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
const warehouseId = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const userId = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const itemId = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
const reportId = '11111111-1111-1111-1111-111111111111';

const adminUser = { id: userId, tenantId, role: 'ADMIN' };

/** Bodega válida que pertenece al contrato correcto */
const validWarehouse = {
  id: warehouseId,
  tenantId,
  contractId,
  code: 'BOD-CAM-01',
  name: 'Camión Lubricador 1',
  type: 'VIRTUAL',
  isActive: true,
};

/** Equipo válido con horómetro actual = 1000 h */
const validEquipment = {
  id: equipmentId,
  tenantId,
  internalId: 'EQ-001',
  currentMeter: 1000,
};

/** Reporte creado simulando el retorno de tx.lubeReport.create */
const createdReport = {
  id: reportId,
  tenantId,
  contractId,
  equipmentId,
  warehouseId,
  userId,
  correlative: 'RCL-00001',
  dispatchDate: new Date('2026-06-02T10:00:00Z'),
  meterReading: 1050,
  notes: null,
  createdAt: new Date(),
};

/** DTO mínimo válido para un despacho estándar */
function buildDto(
  overrides: Partial<CreateLubeReportDto> = {},
): CreateLubeReportDto {
  return {
    contractId,
    equipmentId,
    warehouseId,
    dispatchDate: '2026-06-02T10:00:00Z',
    meterReading: 1050,
    lines: [{ itemId, quantity: 3 }],
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite
// ─────────────────────────────────────────────────────────────────────────────
describe('LubeReportsService — createReport', () => {
  let service: LubeReportsService;
  let prisma: DeepMockProxy<PrismaService>;
  let tx: DeepMockProxy<Prisma.TransactionClient>;
  let sequenceService: { getNextCorrelative: jest.Mock };
  let inventoryStockService: { performTransactionCore: jest.Mock };

  const inventoryItemRow = {
    id: itemId,
    partNumber: 'LUBE-10W',
    inventoryCode: 'IN0001',
    unitOfMeasure: { abbreviation: 'LT', allowsDecimals: true },
  };

  beforeEach(async () => {
    prisma = mockDeep<PrismaService>();
    tx = mockDeep<Prisma.TransactionClient>();
    mockApplyCurrentMeterChange.mockClear();

    sequenceService = {
      getNextCorrelative: jest.fn().mockResolvedValue('RCL-00001'),
    };
    inventoryStockService = {
      performTransactionCore: jest.fn().mockResolvedValue({
        stock: { quantity: 7, unitCost: 850 },
        transaction: {
          isPendingRegularization: false,
          newStock: 7,
          previousStock: 10,
          quantity: 3,
        },
      }),
    };

    prisma.$transaction.mockImplementation(async (fn) =>
      (fn as (client: typeof tx) => Promise<unknown>)(tx),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LubeReportsService,
        { provide: PrismaService, useValue: prisma },
        { provide: SequenceService, useValue: sequenceService },
        {
          provide: InventoryStockService,
          useValue: inventoryStockService,
        },
      ],
    }).compile();

    service = module.get(LubeReportsService);
  });

  // ── HAPPY PATH ─────────────────────────────────────────────────────────────
  it('happy path: crea el reporte, descuenta stock y actualiza horómetro', async () => {
    tx.warehouse.findFirst.mockResolvedValue(validWarehouse as never);
    tx.equipment.findFirst.mockResolvedValue(validEquipment as never);
    tx.inventoryItem.findFirst.mockResolvedValue(inventoryItemRow as never);
    tx.lubeReport.create.mockResolvedValue(createdReport as never);
    tx.lubeReportLine.create.mockResolvedValue({} as never);
    tx.assetCostRecord.create.mockResolvedValue({} as never);

    const result = await service.createReport(buildDto(), adminUser);

    expect(result.id).toBe(reportId);
    expect(result.correlative).toBe('RCL-00001');

    expect(inventoryStockService.performTransactionCore).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        type: 'OUT',
        referenceType: 'LUBE_DISPATCH',
        referenceId: reportId,
        quantity: 3,
      }),
      adminUser,
    );

    // Verifica que el horómetro fue actualizado (meterReading=1050 > currentMeter=1000)
    expect(mockApplyCurrentMeterChange).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        tenantId,
        equipmentId,
        oldMeter: 1000,
        newMeter: 1050,
        source: 'MANUAL',
        userId,
      }),
    );

    // Verifica que se registró el costo directo en el activo
    // CPP=850, qty=3 → total=2550
    expect(tx.assetCostRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'LUBE_DISPATCH',
          equipmentId,
          tenantId,
        }),
      }),
    );
  });

  it('happy path: no llama a applyCurrentMeterChange cuando el horómetro coincide con el actual', async () => {
    tx.warehouse.findFirst.mockResolvedValue(validWarehouse as never);
    // Equipo con currentMeter = 1050, igual al DTO
    tx.equipment.findFirst.mockResolvedValue({
      ...validEquipment,
      currentMeter: 1050,
    } as never);
    tx.inventoryItem.findFirst.mockResolvedValue(inventoryItemRow as never);
    tx.lubeReport.create.mockResolvedValue(createdReport as never);
    tx.lubeReportLine.create.mockResolvedValue({} as never);
    tx.assetCostRecord.create.mockResolvedValue({} as never);

    await service.createReport(buildDto({ meterReading: 1050 }), adminUser);

    expect(mockApplyCurrentMeterChange).not.toHaveBeenCalled();
  });

  it('happy path: no llama a applyCurrentMeterChange cuando el horómetro es omitido', async () => {
    tx.warehouse.findFirst.mockResolvedValue(validWarehouse as never);
    tx.equipment.findFirst.mockResolvedValue(validEquipment as never);
    tx.inventoryItem.findFirst.mockResolvedValue(inventoryItemRow as never);
    tx.lubeReport.create.mockResolvedValue({
      ...createdReport,
      meterReading: null,
    } as never);
    tx.lubeReportLine.create.mockResolvedValue({} as never);
    tx.assetCostRecord.create.mockResolvedValue({} as never);

    await service.createReport(
      buildDto({ meterReading: undefined }),
      adminUser,
    );

    expect(mockApplyCurrentMeterChange).not.toHaveBeenCalled();
  });

  it('delega stock negativo a performTransactionCore (regularización pendiente)', async () => {
    tx.warehouse.findFirst.mockResolvedValue(validWarehouse as never);
    tx.equipment.findFirst.mockResolvedValue(validEquipment as never);
    tx.inventoryItem.findFirst.mockResolvedValue(inventoryItemRow as never);
    tx.lubeReport.create.mockResolvedValue(createdReport as never);
    tx.lubeReportLine.create.mockResolvedValue({} as never);
    tx.assetCostRecord.create.mockResolvedValue({} as never);
    inventoryStockService.performTransactionCore.mockResolvedValue({
      stock: { quantity: -4, unitCost: 850 },
      transaction: { isPendingRegularization: true, newStock: -4 },
    });

    await service.createReport(
      buildDto({ lines: [{ itemId, quantity: 5 }] }),
      adminUser,
    );

    expect(inventoryStockService.performTransactionCore).toHaveBeenCalled();
  });

  it('rechaza cantidad fraccionaria si la UoM no admite decimales', async () => {
    tx.warehouse.findFirst.mockResolvedValue(validWarehouse as never);
    tx.equipment.findFirst.mockResolvedValue(validEquipment as never);
    tx.inventoryItem.findFirst.mockResolvedValue({
      ...inventoryItemRow,
      unitOfMeasure: { abbreviation: 'UN', allowsDecimals: false },
    } as never);

    await expect(
      service.createReport(
        buildDto({ lines: [{ itemId, quantity: 2.5 }] }),
        adminUser,
      ),
    ).rejects.toThrow(/no admite fracciones/);
  });

  it('exige confirmedLargeDispatch en consumo atípico', async () => {
    tx.warehouse.findFirst.mockResolvedValue(validWarehouse as never);
    tx.equipment.findFirst.mockResolvedValue(validEquipment as never);
    tx.inventoryItem.findFirst.mockResolvedValue(inventoryItemRow as never);
    tx.lubeReport.create.mockResolvedValue(createdReport as never);

    await expect(
      service.createReport(
        buildDto({ lines: [{ itemId, quantity: 150 }] }),
        adminUser,
      ),
    ).rejects.toThrow(/confirmedLargeDispatch/);
  });

  // ── FALLA DE NEGOCIO: HORÓMETRO REGRESIVO ──────────────────────────────────
  it('falla de negocio: rechaza y hace rollback si el horómetro es menor al histórico', async () => {
    tx.warehouse.findFirst.mockResolvedValue(validWarehouse as never);
    tx.equipment.findFirst.mockResolvedValue({
      ...validEquipment,
      currentMeter: 1200, // ya está en 1200 h
    } as never);

    // Ingresamos 1100, que es menor al actual (1200)
    await expect(
      service.createReport(buildDto({ meterReading: 1100 }), adminUser),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.createReport(buildDto({ meterReading: 1100 }), adminUser),
    ).rejects.toThrow(/menor al valor actual del equipo/);

    // Nada de stock ni kardex debe haberse tocado
    expect(inventoryStockService.performTransactionCore).not.toHaveBeenCalled();
    expect(tx.lubeReport.create).not.toHaveBeenCalled();
    expect(mockApplyCurrentMeterChange).not.toHaveBeenCalled();
  });

  // ── FALLA DE NEGOCIO: BODEGA FUERA DEL CONTRATO ───────────────────────────
  it('falla de negocio: rechaza si la bodega no pertenece al contrato indicado', async () => {
    const otroContractId = '99999999-9999-9999-9999-999999999999';

    // La bodega existe en el tenant pero está asociada a otro contrato
    tx.warehouse.findFirst.mockResolvedValue({
      ...validWarehouse,
      contractId: otroContractId,
    } as never);

    await expect(service.createReport(buildDto(), adminUser)).rejects.toThrow(
      BadRequestException,
    );

    await expect(service.createReport(buildDto(), adminUser)).rejects.toThrow(
      /no pertenece al contrato indicado/,
    );

    // No debe haberse consultado nada más
    expect(tx.equipment.findFirst).not.toHaveBeenCalled();
    expect(tx.lubeReport.create).not.toHaveBeenCalled();
  });

  // ── FALLA: BODEGA NO EXISTE EN EL TENANT ──────────────────────────────────
  it('lanza NotFoundException si la bodega no existe en el tenant', async () => {
    tx.warehouse.findFirst.mockResolvedValue(null as never);

    await expect(service.createReport(buildDto(), adminUser)).rejects.toThrow(
      NotFoundException,
    );

    await expect(service.createReport(buildDto(), adminUser)).rejects.toThrow(
      /no existe o no pertenece a este tenant/,
    );
  });

  // ── FALLA: EQUIPO NO EXISTE EN EL TENANT ──────────────────────────────────
  it('lanza NotFoundException si el equipo no existe en el tenant', async () => {
    tx.warehouse.findFirst.mockResolvedValue(validWarehouse as never);
    tx.equipment.findFirst.mockResolvedValue(null as never);

    await expect(service.createReport(buildDto(), adminUser)).rejects.toThrow(
      NotFoundException,
    );

    await expect(service.createReport(buildDto(), adminUser)).rejects.toThrow(
      /equipo no existe/,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite: findAll
// ─────────────────────────────────────────────────────────────────────────────
describe('LubeReportsService — findAll', () => {
  let service: LubeReportsService;
  let prisma: DeepMockProxy<PrismaService>;
  let sequenceService: { getNextCorrelative: jest.Mock };

  const rowStub = {
    id: reportId,
    tenantId,
    contractId,
    equipmentId,
    warehouseId,
    userId,
    correlative: 'RCL-00001',
    dispatchDate: new Date('2026-06-02T10:00:00Z'),
    meterReading: 1050,
    notes: null,
    createdAt: new Date(),
    equipment: {
      id: equipmentId,
      internalId: 'EQ-001',
      name: 'Camión 1',
      licensePlate: 'ABC-123',
    },
    warehouse: { id: warehouseId, code: 'BOD-01', name: 'Bodega Central' },
    user: { id: userId, name: 'Técnico A' },
    _count: { lines: 2 },
  };

  beforeEach(async () => {
    prisma = mockDeep<PrismaService>();
    sequenceService = {
      getNextCorrelative: jest.fn().mockResolvedValue('RCL-00001'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LubeReportsService,
        { provide: PrismaService, useValue: prisma },
        { provide: SequenceService, useValue: sequenceService },
        {
          provide: InventoryStockService,
          useValue: { performTransactionCore: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(LubeReportsService);
  });

  it('retorna estructura paginada con lineCount calculado desde _count', async () => {
    prisma.lubeReport.findMany.mockResolvedValue([rowStub] as never);
    prisma.lubeReport.count.mockResolvedValue(1);

    const result = await service.findAll(adminUser);

    expect(result).toMatchObject({
      data: expect.any(Array),
      total: 1,
      page: 1,
      pageSize: 25,
    });
    expect(result.data[0]).toMatchObject({
      id: reportId,
      correlative: 'RCL-00001',
      lineCount: 2,
    });
    // _count no debe exponerse en la respuesta
    expect((result.data[0] as any)._count).toBeUndefined();
  });

  it('aplica filtro de warehouseId en el where de Prisma', async () => {
    prisma.lubeReport.findMany.mockResolvedValue([rowStub] as never);
    prisma.lubeReport.count.mockResolvedValue(1);

    await service.findAll(adminUser, { warehouseId });

    const callArg = prisma.lubeReport.findMany.mock.calls[0][0] as {
      where: { AND: Array<Record<string, unknown>> };
    };
    expect(callArg.where.AND).toEqual(
      expect.arrayContaining([
        { tenantId },
        { warehouseId },
      ]),
    );
  });

  it('aplica filtro de equipmentId en el where de Prisma', async () => {
    prisma.lubeReport.findMany.mockResolvedValue([] as never);
    prisma.lubeReport.count.mockResolvedValue(0);

    await service.findAll(adminUser, { equipmentId });

    const callArg = prisma.lubeReport.findMany.mock.calls[0][0] as {
      where: { AND: Array<Record<string, unknown>> };
    };
    expect(callArg.where.AND).toEqual(
      expect.arrayContaining([
        { tenantId },
        { equipmentId },
      ]),
    );
  });

  it('aplica rango de fechas (dateFrom y dateTo) en el where', async () => {
    prisma.lubeReport.findMany.mockResolvedValue([] as never);
    prisma.lubeReport.count.mockResolvedValue(0);

    await service.findAll(adminUser, {
      dateFrom: '2026-06-01',
      dateTo: '2026-06-02',
    });

    const callArg = prisma.lubeReport.findMany.mock.calls[0][0] as {
      where: { AND: Array<{ dispatchDate?: { gte: Date; lte: Date } }> };
    };
    const dateClause = callArg.where.AND.find((c) => c.dispatchDate);
    expect(dateClause?.dispatchDate?.gte).toBeInstanceOf(Date);
    expect(dateClause?.dispatchDate?.lte).toBeInstanceOf(Date);
  });

  it('respeta la paginación: skip = (page-1) * pageSize', async () => {
    prisma.lubeReport.findMany.mockResolvedValue([] as never);
    prisma.lubeReport.count.mockResolvedValue(30);

    await service.findAll(adminUser, { page: '3', pageSize: '10' } as any);

    expect(prisma.lubeReport.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 20, take: 10 }),
    );
  });

  it('aplica búsqueda insensible en correlativo y relaciones', async () => {
    prisma.lubeReport.findMany.mockResolvedValue([] as never);
    prisma.lubeReport.count.mockResolvedValue(0);

    await service.findAll(adminUser, { search: 'RCL-00042' });

    const callArg = prisma.lubeReport.findMany.mock.calls[0][0] as {
      where: { AND?: Array<{ OR?: unknown[] }> };
    };
    const andClause = callArg.where.AND ?? [];
    const searchBlock = andClause.find((c) => Array.isArray(c.OR));
    expect(searchBlock?.OR?.length).toBeGreaterThan(0);
  });

  it('ordena por campo y dirección solicitados', async () => {
    prisma.lubeReport.findMany.mockResolvedValue([] as never);
    prisma.lubeReport.count.mockResolvedValue(0);

    await service.findAll(adminUser, {
      sort: 'warehouseName',
      dir: 'asc',
    } as any);

    expect(prisma.lubeReport.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { warehouse: { name: 'asc' } },
      }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite: findOne
// ─────────────────────────────────────────────────────────────────────────────
describe('LubeReportsService — findOne', () => {
  let service: LubeReportsService;
  let prisma: DeepMockProxy<PrismaService>;
  let sequenceService: { getNextCorrelative: jest.Mock };

  const detailStub = {
    id: reportId,
    tenantId,
    contractId,
    equipmentId,
    warehouseId,
    userId,
    correlative: 'RCL-00001',
    dispatchDate: new Date('2026-06-02T10:00:00Z'),
    meterReading: 1050,
    notes: null,
    createdAt: new Date(),
    equipment: {
      id: equipmentId,
      internalId: 'EQ-001',
      name: 'Camión 1',
      licensePlate: null,
    },
    warehouse: { id: warehouseId, code: 'BOD-01', name: 'Bodega Central' },
    user: { id: userId, name: 'Técnico A' },
    lines: [
      {
        id: '22222222-2222-2222-2222-222222222222',
        reportId,
        itemId,
        quantity: 3,
        unitCost: new Prisma.Decimal('850.0000'),
        item: {
          id: itemId,
          name: 'Aceite 15W40',
          inventoryCode: 'IN0042',
          partNumber: null,
          unitOfMeasure: { id: 'uuu', name: 'Litro', abbreviation: 'L' },
        },
      },
    ],
  };

  beforeEach(async () => {
    prisma = mockDeep<PrismaService>();
    sequenceService = { getNextCorrelative: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LubeReportsService,
        { provide: PrismaService, useValue: prisma },
        { provide: SequenceService, useValue: sequenceService },
        {
          provide: InventoryStockService,
          useValue: { performTransactionCore: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(LubeReportsService);
  });

  it('retorna el reporte con sus líneas y el detalle del artículo', async () => {
    prisma.lubeReport.findFirst.mockResolvedValue(detailStub as never);

    const result = await service.findOne(reportId, adminUser);

    expect(result.id).toBe(reportId);
    expect(result.correlative).toBe('RCL-00001');
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].item.name).toBe('Aceite 15W40');
  });

  it('filtra por tenantId: no devuelve un reporte de otro tenant', async () => {
    // findFirst devuelve null porque el tenantId no coincide
    prisma.lubeReport.findFirst.mockResolvedValue(null as never);

    await expect(service.findOne(reportId, adminUser)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('lanza NotFoundException si el id no existe', async () => {
    prisma.lubeReport.findFirst.mockResolvedValue(null as never);

    await expect(
      service.findOne('00000000-0000-0000-0000-000000000000', adminUser),
    ).rejects.toThrow(NotFoundException);

    await expect(
      service.findOne('00000000-0000-0000-0000-000000000000', adminUser),
    ).rejects.toThrow(/no existe o no pertenece a este tenant/);
  });
});
