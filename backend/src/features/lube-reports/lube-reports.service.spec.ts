import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SequenceService } from '../../common/sequence/sequence.service';
import { LubeReportsService } from './lube-reports.service';
import { CreateLubeReportDto } from './dto/create-lube-report.dto';

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

/** Stock actual del ítem con CPP = 850 */
const currentStock = {
  warehouseId,
  itemId,
  quantity: 10,
  unitCost: new Prisma.Decimal('850.0000'),
  minStock: 2,
  maxStock: 50,
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

  beforeEach(async () => {
    prisma = mockDeep<PrismaService>();
    tx = mockDeep<Prisma.TransactionClient>();
    mockApplyCurrentMeterChange.mockClear();

    sequenceService = {
      getNextCorrelative: jest.fn().mockResolvedValue('RCL-00001'),
    };

    // Patrón estándar: $transaction delega al callback con el tx mock
    prisma.$transaction.mockImplementation(async (fn) =>
      (fn as (client: typeof tx) => Promise<unknown>)(tx),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LubeReportsService,
        { provide: PrismaService, useValue: prisma },
        { provide: SequenceService, useValue: sequenceService },
      ],
    }).compile();

    service = module.get(LubeReportsService);
  });

  // ── HAPPY PATH ─────────────────────────────────────────────────────────────
  it('happy path: crea el reporte, descuenta stock y actualiza horómetro', async () => {
    tx.warehouse.findFirst.mockResolvedValue(validWarehouse as never);
    tx.equipment.findFirst.mockResolvedValue(validEquipment as never);
    tx.itemStock.findUnique.mockResolvedValue(currentStock as never);
    tx.itemStock.upsert.mockResolvedValue({ ...currentStock, quantity: 7 } as never);
    tx.inventoryTransaction.create.mockResolvedValue({} as never);
    tx.lubeReport.create.mockResolvedValue(createdReport as never);
    tx.lubeReportLine.create.mockResolvedValue({} as never);
    tx.assetCostRecord.create.mockResolvedValue({} as never);

    const result = await service.createReport(buildDto(), adminUser);

    // Verifica que el reporte fue creado correctamente
    expect(result.id).toBe(reportId);
    expect(result.correlative).toBe('RCL-00001');

    // Verifica que el stock se decrementó (upsert con newQty = 10 - 3 = 7)
    expect(tx.itemStock.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { quantity: 7 },
      }),
    );

    // Verifica que se generó una transacción de kardex tipo OUT con referenceType correcto
    expect(tx.inventoryTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'OUT',
          referenceType: 'LUBE_DISPATCH',
          referenceId: reportId,
          quantity: 3,
          previousStock: 10,
          newStock: 7,
          isPendingRegularization: false,
        }),
      }),
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
    tx.itemStock.findUnique.mockResolvedValue(currentStock as never);
    tx.itemStock.upsert.mockResolvedValue({ ...currentStock, quantity: 7 } as never);
    tx.inventoryTransaction.create.mockResolvedValue({} as never);
    tx.lubeReport.create.mockResolvedValue(createdReport as never);
    tx.lubeReportLine.create.mockResolvedValue({} as never);
    tx.assetCostRecord.create.mockResolvedValue({} as never);

    await service.createReport(buildDto({ meterReading: 1050 }), adminUser);

    // Si meterReading === currentMeter no debe actualizarse el medidor
    expect(mockApplyCurrentMeterChange).not.toHaveBeenCalled();
  });

  it('happy path: no llama a applyCurrentMeterChange cuando el horómetro es omitido', async () => {
    tx.warehouse.findFirst.mockResolvedValue(validWarehouse as never);
    tx.equipment.findFirst.mockResolvedValue(validEquipment as never);
    tx.itemStock.findUnique.mockResolvedValue(currentStock as never);
    tx.itemStock.upsert.mockResolvedValue({ ...currentStock, quantity: 7 } as never);
    tx.inventoryTransaction.create.mockResolvedValue({} as never);
    tx.lubeReport.create.mockResolvedValue(
      { ...createdReport, meterReading: null } as never,
    );
    tx.lubeReportLine.create.mockResolvedValue({} as never);
    tx.assetCostRecord.create.mockResolvedValue({} as never);

    // Sin meterReading en el DTO
    await service.createReport(buildDto({ meterReading: undefined }), adminUser);

    expect(mockApplyCurrentMeterChange).not.toHaveBeenCalled();
  });

  it('happy path: marca isPendingRegularization cuando el stock queda negativo', async () => {
    tx.warehouse.findFirst.mockResolvedValue(validWarehouse as never);
    tx.equipment.findFirst.mockResolvedValue(validEquipment as never);

    // Solo hay 1 unidad en stock pero se despachan 5
    tx.itemStock.findUnique.mockResolvedValue({
      ...currentStock,
      quantity: 1,
    } as never);
    tx.itemStock.upsert.mockResolvedValue({ ...currentStock, quantity: -4 } as never);
    tx.inventoryTransaction.create.mockResolvedValue({} as never);
    tx.lubeReport.create.mockResolvedValue(createdReport as never);
    tx.lubeReportLine.create.mockResolvedValue({} as never);
    tx.assetCostRecord.create.mockResolvedValue({} as never);

    await service.createReport(buildDto({ lines: [{ itemId, quantity: 5 }] }), adminUser);

    // La transacción de kardex debe tener isPendingRegularization en true
    expect(tx.inventoryTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          newStock: -4,
          isPendingRegularization: true,
        }),
      }),
    );
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
    expect(tx.itemStock.upsert).not.toHaveBeenCalled();
    expect(tx.inventoryTransaction.create).not.toHaveBeenCalled();
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

    await expect(
      service.createReport(buildDto(), adminUser),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.createReport(buildDto(), adminUser),
    ).rejects.toThrow(/no pertenece al contrato indicado/);

    // No debe haberse consultado nada más
    expect(tx.equipment.findFirst).not.toHaveBeenCalled();
    expect(tx.lubeReport.create).not.toHaveBeenCalled();
  });

  // ── FALLA: BODEGA NO EXISTE EN EL TENANT ──────────────────────────────────
  it('lanza NotFoundException si la bodega no existe en el tenant', async () => {
    tx.warehouse.findFirst.mockResolvedValue(null as never);

    await expect(
      service.createReport(buildDto(), adminUser),
    ).rejects.toThrow(NotFoundException);

    await expect(
      service.createReport(buildDto(), adminUser),
    ).rejects.toThrow(/no existe o no pertenece a este tenant/);
  });

  // ── FALLA: EQUIPO NO EXISTE EN EL TENANT ──────────────────────────────────
  it('lanza NotFoundException si el equipo no existe en el tenant', async () => {
    tx.warehouse.findFirst.mockResolvedValue(validWarehouse as never);
    tx.equipment.findFirst.mockResolvedValue(null as never);

    await expect(
      service.createReport(buildDto(), adminUser),
    ).rejects.toThrow(NotFoundException);

    await expect(
      service.createReport(buildDto(), adminUser),
    ).rejects.toThrow(/equipo no existe/);
  });
});
