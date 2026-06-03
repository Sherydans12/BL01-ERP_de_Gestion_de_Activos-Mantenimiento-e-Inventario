/**
 * Suite de integración transversal: "El Caos en Terreno"
 *
 * Objetivo: verificar que el horómetro (currentMeter) y su historial
 * (EquipmentMeterLog) son a prueba de balas cuando tres módulos de
 * operaciones (M2, M1, M3) registran lecturas concurrentes sobre el
 * mismo equipo, incluyendo un error humano con horómetro regresivo.
 *
 * Estrategia de mock:
 *  - Los tres servicios comparten un mismo `prisma` mock y el mismo `tx` mock.
 *  - applyCurrentMeterChange NO se mockea → se usa la implementación real.
 *  - `tx.equipment.update` y `tx.equipmentMeterLog.create` interceptan las
 *    escrituras para mantener el estado mutable del equipo y capturar los logs.
 *  - `tx.equipment.findFirst` devuelve siempre el estado actual del equipo.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { mockDeep, DeepMockProxy } from 'jest-mock-extended';
import {
  AffectedSystem,
  FaultCriticality,
  FaultReportStatus,
  MeterLogSource,
  OperationalStatus,
  Prisma,
  ShiftType,
} from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { SequenceService } from '../../common/sequence/sequence.service';
import { StorageService } from '../../common/storage/storage.service';
import { NotificationDispatcherService } from '../../common/notifications/notification-dispatcher.service';
import { EquipmentAvailabilityService } from '../equipment-availability/equipment-availability.service';
import { LubeReportsService } from '../lube-reports/lube-reports.service';
import { FaultReportsService } from '../fault-reports/fault-reports.service';

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const tenantId    = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const contractId  = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const equipmentId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const warehouseId = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const itemId      = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const userId      = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

const adminUser    = { id: userId, tenantId, role: 'ADMIN', allowedContracts: [] as string[] };
const operatorUser = { id: userId, tenantId, role: 'USER' };

// Estado mutable que simula la fila en DB entre transacciones
interface EquipmentState {
  id: string;
  tenantId: string;
  contractId: string;
  subcontractId: null;
  currentMeter: number;
  isOperational: boolean;
}

// Log capturado: escrito por applyCurrentMeterChange en tx.equipmentMeterLog.create
interface CapturedMeterLog {
  oldValue: Prisma.Decimal;
  newValue: Prisma.Decimal;
  source: MeterLogSource;
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite
// ─────────────────────────────────────────────────────────────────────────────

describe('Cross-Module — El Caos en Terreno: integridad del horómetro bajo registros concurrentes', () => {
  let availabilityService: EquipmentAvailabilityService;
  let lubeService: LubeReportsService;
  let faultService: FaultReportsService;

  let prisma: DeepMockProxy<PrismaService>;
  let tx: DeepMockProxy<Prisma.TransactionClient>;

  let equipmentState: EquipmentState;
  let capturedLogs: CapturedMeterLog[];

  let sequenceService: { getNextCorrelative: jest.Mock };
  let dispatcher: { dispatch: jest.Mock };

  beforeEach(async () => {
    // ── Estado inicial: equipo en 5000 horas, operativo ───────────────────────
    equipmentState = {
      id: equipmentId,
      tenantId,
      contractId,
      subcontractId: null,
      currentMeter: 5000,
      isOperational: true,
    };
    capturedLogs = [];

    prisma = mockDeep<PrismaService>();
    tx    = mockDeep<Prisma.TransactionClient>();

    sequenceService = { getNextCorrelative: jest.fn().mockResolvedValue('RF-00001') };
    dispatcher      = { dispatch: jest.fn().mockResolvedValue(undefined) };

    // Patrón estándar de transacción: todos los servicios comparten el mismo tx
    prisma.$transaction.mockImplementation(async (fn) =>
      (fn as (client: typeof tx) => Promise<unknown>)(tx),
    );

    // ── Interceptores de estado del equipo ────────────────────────────────────

    // Devuelve siempre un snapshot del estado mutable actual
    tx.equipment.findFirst.mockImplementation(async () =>
      ({ ...equipmentState }) as never,
    );

    // Captura actualizaciones de currentMeter (applyCurrentMeterChange)
    // e isOperational (FaultReportsService para criticidad ALTA)
    tx.equipment.update.mockImplementation(async (args: any) => {
      const data = args.data as { currentMeter?: number; isOperational?: boolean };
      if (data.currentMeter !== undefined) {
        equipmentState.currentMeter = data.currentMeter;
      }
      if (data.isOperational !== undefined) {
        equipmentState.isOperational = data.isOperational;
      }
      return { ...equipmentState } as never;
    });

    // Captura los logs de horómetro creados por la implementación real del helper
    tx.equipmentMeterLog.create.mockImplementation(async (args: any) => {
      capturedLogs.push({
        oldValue: args.data.oldValue as Prisma.Decimal,
        newValue: args.data.newValue as Prisma.Decimal,
        source:   args.data.source   as MeterLogSource,
      });
      return { id: 'meter-log-id', ...args.data } as never;
    });

    // ── Mocks M2: EquipmentAvailability ───────────────────────────────────────
    tx.equipmentAvailability.create.mockResolvedValue({
      id: 'avail-day-001',
      tenantId,
      contractId,
      equipmentId,
      reportedById: userId,
      reportDate: new Date('2026-06-03'),
      shift:       ShiftType.DAY,
      status:      OperationalStatus.OPERATIONAL,
      meterReading: 5050,
      comments:  null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    // ── Mocks M1: LubeReports ─────────────────────────────────────────────────
    tx.warehouse.findFirst.mockResolvedValue({
      id: warehouseId,
      tenantId,
      contractId,
      code: 'BOD-LUB-01',
      name: 'Camión Lubricador',
      type: 'VIRTUAL',
      isActive: true,
    } as never);
    tx.itemStock.findUnique.mockResolvedValue({
      warehouseId,
      itemId,
      quantity: 50,
      unitCost: new Prisma.Decimal('850.00'),
      minStock: 5,
      maxStock:  100,
    } as never);
    tx.itemStock.upsert.mockResolvedValue({ quantity: 47 } as never);
    tx.inventoryTransaction.create.mockResolvedValue({} as never);
    tx.lubeReport.create.mockResolvedValue({
      id: 'lube-report-001',
      tenantId,
      contractId,
      equipmentId,
      warehouseId,
      userId,
      correlative: 'RCL-00001',
      dispatchDate: new Date('2026-06-03T09:00:00Z'),
      meterReading: 5040,
      notes: null,
      createdAt: new Date(),
    } as never);
    tx.lubeReportLine.create.mockResolvedValue({} as never);
    tx.assetCostRecord.create.mockResolvedValue({} as never);

    // ── Mocks M3: FaultReports ────────────────────────────────────────────────
    tx.faultReport.create.mockResolvedValue({
      id:                   'fault-report-001',
      tenantId,
      contractId,
      equipmentId,
      reportedById:         userId,
      correlative:          'RF-00001',
      eventDate:            new Date('2026-06-03T14:00:00Z'),
      meterAtFault:         5100,
      affectedSystem:       AffectedSystem.MOTOR,
      criticality:          FaultCriticality.HIGH,
      symptomDescription:   'Motor con humo negro y pérdida de potencia.',
      status:               FaultReportStatus.OPEN,
      workOrderId:          null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);
    tx.workOrder.count.mockResolvedValue(10 as never);
    tx.workOrder.create.mockResolvedValue({
      id:           'work-order-001',
      tenantId,
      correlative:  'OT-2026-011',
      equipmentId,
      status:       'OPEN',
      category:     'NO_PROGRAMADA_REACTIVA',
    } as never);
    tx.faultReport.update.mockResolvedValue({
      id:                 'fault-report-001',
      tenantId,
      contractId,
      equipmentId,
      reportedById:       userId,
      correlative:        'RF-00001',
      eventDate:          new Date('2026-06-03T14:00:00Z'),
      meterAtFault:       5100,
      affectedSystem:     AffectedSystem.MOTOR,
      criticality:        FaultCriticality.HIGH,
      symptomDescription: 'Motor con humo negro y pérdida de potencia.',
      workOrderId:        'work-order-001',
      status:             FaultReportStatus.LINKED,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    // Notificación EQUIPMENT_DOWN: retorna temprano cuando el equipo no se encuentra
    prisma.equipment.findUnique.mockResolvedValue(null as never);
    prisma.user.findMany.mockResolvedValue([] as never);

    // ── Construir módulos con el mismo prisma mock compartido ─────────────────
    const [m2Module, m1Module, m3Module]: TestingModule[] = await Promise.all([
      Test.createTestingModule({
        providers: [
          EquipmentAvailabilityService,
          { provide: PrismaService, useValue: prisma },
        ],
      }).compile(),
      Test.createTestingModule({
        providers: [
          LubeReportsService,
          { provide: PrismaService,   useValue: prisma },
          { provide: SequenceService, useValue: sequenceService },
        ],
      }).compile(),
      Test.createTestingModule({
        providers: [
          FaultReportsService,
          { provide: PrismaService,                  useValue: prisma },
          { provide: SequenceService,                useValue: sequenceService },
          { provide: StorageService,                 useValue: mockDeep<StorageService>() },
          { provide: NotificationDispatcherService,  useValue: dispatcher },
          { provide: ConfigService,                  useValue: { get: jest.fn(() => '') } },
        ],
      }).compile(),
    ]);

    availabilityService = m2Module.get(EquipmentAvailabilityService);
    lubeService         = m1Module.get(LubeReportsService);
    faultService        = m3Module.get(FaultReportsService);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST PRINCIPAL: El Caos en Terreno
  // ═══════════════════════════════════════════════════════════════════════════

  it('El Caos en Terreno: horómetro avanza 5000→5050 y 5050→5100; M1 rechaza lectura errónea sin alterar estado', async () => {
    // ── Paso a) Turno Día (M2): supervisor reporta disponibilidad a 5050 hrs ──
    await availabilityService.create(
      {
        equipmentId,
        reportDate: '2026-06-03',
        shift:      ShiftType.DAY,
        status:     OperationalStatus.OPERATIONAL,
        meterReading: 5050,
      },
      adminUser,
    );

    // El horómetro avanzó correctamente (5000 → 5050) vía applyCurrentMeterChange
    expect(equipmentState.currentMeter).toBe(5050);
    expect(equipmentState.isOperational).toBe(true);

    // Se generó exactamente 1 log con fuente AVAILABILITY_REPORT
    expect(capturedLogs).toHaveLength(1);
    expect(capturedLogs[0]).toMatchObject({
      oldValue: new Prisma.Decimal(5000),
      newValue: new Prisma.Decimal(5050),
      source:   MeterLogSource.AVAILABILITY_REPORT,
    });

    // ── Paso b) Carga de Aceite (M1): operario anota 5040 hrs por error ───────
    //
    // COMPORTAMIENTO REAL: M1 es el módulo estricto. Si meterReading < currentMeter,
    // rechaza la OPERACIÓN COMPLETA (incluyendo el despacho de aceite).
    // Esto garantiza que no se guarden consumos con horómetros incoherentes.
    //
    // Contraste con M2/M3: ellos guardan el registro y solo omiten la actualización
    // del medidor (comportamiento "lenient" documentado en los tests siguientes).
    await expect(
      lubeService.createReport(
        {
          contractId,
          equipmentId,
          warehouseId,
          dispatchDate:  '2026-06-03T09:00:00Z',
          meterReading:  5040, // ← lectura errónea: 5040 < currentMeter (5050)
          lines: [{ itemId, quantity: 3 }],
        },
        adminUser,
      ),
    ).rejects.toThrow(BadRequestException);

    // El rechazo de M1 es limpio: ni el medidor ni la operatividad se modificaron
    expect(equipmentState.currentMeter).toBe(5050);   // sin cambios
    expect(equipmentState.isOperational).toBe(true);  // sin cambios
    expect(capturedLogs).toHaveLength(1);             // ningún log adicional

    // ── Paso c) Falla ALTA (M3): operario reporta falla crítica a 5100 hrs ────
    await faultService.create(
      {
        equipmentId,
        eventDate:          '2026-06-03T14:00:00Z',
        affectedSystem:     AffectedSystem.MOTOR,
        criticality:        FaultCriticality.HIGH,
        symptomDescription: 'Motor con humo negro y pérdida de potencia.',
        meterAtFault:       5100,
      },
      operatorUser,
    );

    // ── Afirmaciones finales sobre el estado del equipo ───────────────────────

    // El medidor llegó a 5100 (M3 avanzó desde 5050)
    expect(equipmentState.currentMeter).toBe(5100);

    // La falla ALTA marcó el equipo fuera de servicio
    expect(equipmentState.isOperational).toBe(false);

    // ── Afirmaciones finales sobre el historial del horómetro ─────────────────
    // Exactamente 2 logs: M1 fue rechazado, M2 y M3 contribuyeron uno cada uno.
    // No hay rastro del horómetro erróneo de 5040.
    expect(capturedLogs).toHaveLength(2);

    // Log 1 (M2): primer avance válido del turno día
    expect(capturedLogs[0]).toMatchObject({
      oldValue: new Prisma.Decimal(5000),
      newValue: new Prisma.Decimal(5050),
      source:   MeterLogSource.AVAILABILITY_REPORT,
    });

    // Log 2 (M3): segundo avance, registrado junto a la falla crítica
    expect(capturedLogs[1]).toMatchObject({
      oldValue: new Prisma.Decimal(5050),
      newValue: new Prisma.Decimal(5100),
      source:   MeterLogSource.FAULT_REPORT,
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST DE CONTRASTE: comportamiento lenient de M2
  // ═══════════════════════════════════════════════════════════════════════════

  it('M2 (lenient): guarda el parte de disponibilidad aunque el horómetro en meterReading retroceda', async () => {
    // Simula que el equipo ya está en 5200 hrs
    equipmentState.currentMeter = 5200;

    // M2 recibe meterReading=5050 (< 5200) → guarda el parte, NO actualiza medidor
    const result = await availabilityService.create(
      {
        equipmentId,
        reportDate:   '2026-06-03',
        shift:        ShiftType.NIGHT,
        status:       OperationalStatus.STANDBY,
        meterReading: 5050, // ← retrocede, pero M2 no lanza excepción
      },
      adminUser,
    );

    // El parte fue guardado correctamente
    expect(result.id).toBe('avail-day-001');

    // El medidor no se modificó (M2 ignora silenciosamente el retroceso)
    expect(equipmentState.currentMeter).toBe(5200);
    expect(capturedLogs).toHaveLength(0);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST DE CONTRASTE: comportamiento lenient de M3
  // ═══════════════════════════════════════════════════════════════════════════

  it('M3 (lenient): registra la falla aunque meterAtFault retroceda respecto al currentMeter', async () => {
    // Simula que el equipo ya está en 5500 hrs
    equipmentState.currentMeter = 5500;

    // Usar criticidad LOW para que no haya OT ni efecto en isOperational,
    // y retornar el report con criticality LOW para no disparar notificación.
    tx.faultReport.create.mockResolvedValueOnce({
      id:                   'fault-report-001',
      tenantId,
      contractId,
      equipmentId,
      reportedById:         userId,
      correlative:          'RF-00001',
      eventDate:            new Date('2026-06-03T16:00:00Z'),
      meterAtFault:         5300,
      affectedSystem:       AffectedSystem.ELECTRICAL,
      criticality:          FaultCriticality.LOW,
      symptomDescription:   'Falla en sistema eléctrico.',
      status:               FaultReportStatus.OPEN,
      workOrderId:          null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    // M3 recibe meterAtFault=5300 (< 5500) → guarda la falla, NO actualiza medidor
    const result = await faultService.create(
      {
        equipmentId,
        eventDate:          '2026-06-03T16:00:00Z',
        affectedSystem:     AffectedSystem.ELECTRICAL,
        criticality:        FaultCriticality.LOW,
        symptomDescription: 'Falla en sistema eléctrico.',
        meterAtFault:       5300, // ← retrocede, pero M3 no lanza excepción
      },
      operatorUser,
    );

    // La falla fue guardada correctamente
    expect(result.id).toBe('fault-report-001');

    // El medidor no se modificó (M3 ignora silenciosamente el retroceso)
    expect(equipmentState.currentMeter).toBe(5500);
    expect(equipmentState.isOperational).toBe(true); // LOW no afecta operatividad
    expect(capturedLogs).toHaveLength(0);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST: doble avance secuencial en el mismo turno (M2 → M3)
  // Verifica que el segundo avance usa el medidor actualizado por el primero
  // ═══════════════════════════════════════════════════════════════════════════

  it('doble avance secuencial M2→M3: cada módulo parte desde el medidor real actualizado', async () => {
    // Paso 1: M2 avanza de 5000 a 5200
    tx.equipmentAvailability.create.mockResolvedValueOnce({
      id: 'avail-001',
      tenantId,
      contractId,
      equipmentId,
      reportedById: userId,
      reportDate: new Date('2026-06-03'),
      shift:       ShiftType.DAY,
      status:      OperationalStatus.OPERATIONAL,
      meterReading: 5200,
      comments:  null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    await availabilityService.create(
      {
        equipmentId,
        reportDate:   '2026-06-03',
        shift:        ShiftType.DAY,
        status:       OperationalStatus.OPERATIONAL,
        meterReading: 5200,
      },
      adminUser,
    );

    expect(equipmentState.currentMeter).toBe(5200);

    // Paso 2: M3 parte de 5200 (el estado actualizado) y avanza a 5350
    await faultService.create(
      {
        equipmentId,
        eventDate:          '2026-06-03T20:00:00Z',
        affectedSystem:     AffectedSystem.HYDRAULIC,
        criticality:        FaultCriticality.HIGH,
        symptomDescription: 'Pérdida de presión hidráulica.',
        meterAtFault:       5350,
      },
      operatorUser,
    );

    expect(equipmentState.currentMeter).toBe(5350);
    expect(equipmentState.isOperational).toBe(false);

    // 2 logs: 5000→5200 (M2) y 5200→5350 (M3)
    expect(capturedLogs).toHaveLength(2);
    expect(capturedLogs[0]).toMatchObject({
      oldValue: new Prisma.Decimal(5000),
      newValue: new Prisma.Decimal(5200),
      source:   MeterLogSource.AVAILABILITY_REPORT,
    });
    expect(capturedLogs[1]).toMatchObject({
      oldValue: new Prisma.Decimal(5200),
      newValue: new Prisma.Decimal(5350),
      source:   MeterLogSource.FAULT_REPORT,
    });
  });
});
