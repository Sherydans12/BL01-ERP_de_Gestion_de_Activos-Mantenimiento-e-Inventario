import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { of } from 'rxjs';

import { EquipmentDetailModalComponent } from './equipment-detail-modal.component';
import { FleetService } from '../../../core/services/fleet/fleet.service';
import { FaultReportsService } from '../../../core/services/fault-reports/fault-reports.service';
import { EquipmentAvailabilityService } from '../../../core/services/equipment-availability/equipment-availability.service';
import { LubeReportsService } from '../../../core/services/lube-reports/lube-reports.service';
import { WorkOrdersService } from '../../../core/services/work-orders/work-orders.service';
import { EquipmentMeterLog } from '../../../core/models/types';

// ── Stubs ──────────────────────────────────────────────────────────────────────

const MOCK_ANALYTICS: any = {
  equipment: {
    id: 'eq-001', internalId: 'EC-3005', brand: 'Caterpillar', model: '980G',
    plate: 'AB-1234', type: 'Pala', meterType: 'HOURS', currentMeter: 1500,
    initialMeter: 0, isOperational: true,
    soapExp: null, techReviewExp: null, circPermitExp: null,
    mechanicalCertExp: null, liabilityPolicyExp: null,
    maintenanceFrequency: null, lastMaintenanceMeter: null,
  },
  workOrders:       [],
  meterAdjustments: [],
  assetCostRecords: [],
  meterLogs:        [],
};

const revisionByEquipment = new Map<string, ReturnType<typeof signal<number>>>();

function equipmentRevisionSignal(id: string) {
  if (!revisionByEquipment.has(id)) {
    revisionByEquipment.set(id, signal(0));
  }
  return revisionByEquipment.get(id)!;
}

const fleetSpy = {
  getEquipmentAnalytics: jasmine
    .createSpy('getEquipmentAnalytics')
    .and.returnValue(of(MOCK_ANALYTICS)),
  equipmentRevision: (id: string) => equipmentRevisionSignal(id),
} as unknown as FleetService;
const faultSpy       = jasmine.createSpyObj<FaultReportsService>('FaultReportsService',       { getReports: of({ data: [], total: 0, page: 1, pageSize: 1 }) });
const availSpy       = jasmine.createSpyObj<EquipmentAvailabilityService>('EquipmentAvailabilityService', { getAll: of({ data: [], total: 0, page: 1, pageSize: 1 }) });
const lubeSpy        = jasmine.createSpyObj<LubeReportsService>('LubeReportsService',         { getReports: of({ data: [], total: 0, page: 1, pageSize: 5 }) });
const workOrdersSpy  = jasmine.createSpyObj<WorkOrdersService>('WorkOrdersService',           { getWorkOrdersFiltered: of({ data: [], total: 0 }) });

// ─────────────────────────────────────────────────────────────────────────────

describe('EquipmentDetailModalComponent', () => {
  let component: EquipmentDetailModalComponent;
  let fixture: ComponentFixture<EquipmentDetailModalComponent>;

  beforeEach(async () => {
    revisionByEquipment.clear();
    (fleetSpy.getEquipmentAnalytics as jasmine.Spy).calls.reset();
    availSpy.getAll.calls.reset();
    availSpy.getAll.and.returnValue(of({ data: [], total: 0, page: 1, pageSize: 1 }));

    await TestBed.configureTestingModule({
      imports: [EquipmentDetailModalComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: FleetService,                    useValue: fleetSpy },
        { provide: FaultReportsService,             useValue: faultSpy },
        { provide: EquipmentAvailabilityService,    useValue: availSpy },
        { provide: LubeReportsService,              useValue: lubeSpy },
        { provide: WorkOrdersService,               useValue: workOrdersSpy },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(EquipmentDetailModalComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('debería crearse', () => {
    expect(component).toBeTruthy();
  });

  it('inicia sin equipo cargado (analytics null)', () => {
    expect(component.analytics()).toBeNull();
  });

  it('inicia en la pestaña "ficha"', () => {
    expect(component.activeTab()).toBe('ficha');
  });

  it('inicia sin carga activa', () => {
    expect(component.loading()).toBeFalse();
  });

  it('operationalStatus muestra "OPERATIVO" cuando isOperational es true', () => {
    // Simular analytics con equipo operativo
    component['analytics'].set(MOCK_ANALYTICS);
    const status = component.operationalStatus();
    expect(status.label).toBe('OPERATIVO');
    expect(status.color).toBe('text-success');
  });

  it('operationalStatus muestra el último estado M2 STANDBY aunque isOperational sea true', () => {
    component['analytics'].set(MOCK_ANALYTICS);
    component.lastAvailability.set({
      id: 'avail-1',
      tenantId: 'tenant-1',
      contractId: 'contract-1',
      equipmentId: 'eq-001',
      reportedById: 'usr-1',
      reportDate: '2026-06-07',
      shift: 'DAY',
      status: 'STANDBY',
      meterReading: null,
      comments: null,
      isAvailable: true,
      createdAt: '2026-06-07T00:59:00.000Z',
      updatedAt: '2026-06-07T00:59:00.000Z',
      equipment: {
        id: 'eq-001',
        internalId: 'EC-3005',
        brand: 'Caterpillar',
        model: '980G',
        plate: 'AB-1234',
      },
      reportedBy: { id: 'usr-1', name: 'Nicolás Admin' },
    });

    const status = component.operationalStatus();

    expect(status.label).toBe('Standby');
    expect(status.color).toBe('text-blue-400');
    expect(status.dotColor).toBe('bg-blue-400');
    expect(status.borderColor).toBe('border-blue-500/40');
    expect(status.description).toContain('Standby');
  });

  it('formatDateOnly muestra la fecha de negocio sin desfase por zona horaria', () => {
    expect(component.formatDateOnly('2026-06-07T00:00:00.000Z')).toBe('07/06/2026');
    expect(component.formatDateOnly('2026-06-07')).toBe('07/06/2026');
  });

  it('operationalStatus muestra "FUERA DE SERVICIO" cuando isOperational es false', () => {
    const downAnalytics = {
      ...MOCK_ANALYTICS,
      equipment: { ...MOCK_ANALYTICS.equipment, isOperational: false },
    };
    component['analytics'].set(downAnalytics);
    const status = component.operationalStatus();
    expect(status.label).toBe('FUERA DE SERVICIO');
    expect(status.color).toBe('text-error');
  });

  it('selectTab("salud") dispara carga perezosa de M2/M3', () => {
    component['analytics'].set(MOCK_ANALYTICS);
    // Forzar equipmentId como si el input hubiera sido seteado
    (component as any)['equipmentId'] = jasmine.createSpy().and.returnValue('eq-001');
    spyOn<any>(component, 'loadHealth').and.callThrough();

    component.selectTab('salud');

    expect(component.activeTab()).toBe('salud');
  });

  it('selectTab("consumos") dispara carga perezosa de M1', () => {
    component.selectTab('consumos');
    expect(component.activeTab()).toBe('consumos');
  });

  it('meterUnit retorna "Hrs" cuando el equipo usa horómetro', () => {
    component['analytics'].set(MOCK_ANALYTICS);
    expect(component.meterUnit()).toBe('Hrs');
  });

  it('lastFault inicia en null hasta que se carga la pestaña de salud', () => {
    expect(component.lastFault()).toBeNull();
  });

  it('lubeReports inicia vacío hasta que se carga la pestaña de consumos', () => {
    expect(component.lubeReports()).toEqual([]);
  });

  it('la pestaña "ots" existe en la lista de tabs', () => {
    const ids = component.tabs.map((t) => t.id);
    expect(ids).toContain('ots');
  });

  it('allOts inicia vacío antes de abrir la pestaña de OTs', () => {
    expect(component.allOts()).toEqual([]);
  });

  it('selectTab("ots") activa la pestaña de Órdenes de Trabajo', () => {
    component.selectTab('ots');
    expect(component.activeTab()).toBe('ots');
  });

  it('openOtDetail abre el modal de OT embebido sin perder el contexto', () => {
    component.openOtDetail('ot-uuid-123');
    expect(component.selectedOtId()).toBe('ot-uuid-123');
    expect(component.showOtDetail()).toBeTrue();
  });

  it('closeOtDetail cierra el modal de OT embebido', () => {
    component.openOtDetail('ot-uuid-123');
    component.closeOtDetail();
    expect(component.showOtDetail()).toBeFalse();
    expect(component.selectedOtId()).toBeNull();
  });

  // ── Sprint 2.1: Consumos unificados (repuestos de OTs) ──
  it('partsConsumed aplana los repuestos de las OT y calcula el costo de línea', () => {
    component['analytics'].set({
      ...MOCK_ANALYTICS,
      workOrders: [
        {
          id: 'wo-1',
          correlative: 'OT-100',
          status: 'CLOSED',
          closedAt: '2026-05-01T10:00:00.000Z',
          createdAt: '2026-04-30T10:00:00.000Z',
          parts: [
            { id: 'p1', partNumber: 'FIL-01', description: 'Filtro', quantity: 2, unitCost: 5000 },
            { id: 'p2', partNumber: 'ACE-10', description: 'Aceite', quantity: 1, unitCost: null },
          ],
        },
      ],
    } as any);

    const rows = component.partsConsumed();
    expect(rows.length).toBe(2);
    const filtro = rows.find((r) => r.partNumber === 'FIL-01');
    expect(filtro?.otCorrelative).toBe('OT-100');
    expect(filtro?.lineCost).toBe(10000);
    // Repuesto sin costo unitario → lineCost null (no rompe el total).
    expect(rows.find((r) => r.partNumber === 'ACE-10')?.lineCost).toBeNull();
  });

  it('partsTotalCost suma solo las líneas con costo conocido', () => {
    component['analytics'].set({
      ...MOCK_ANALYTICS,
      workOrders: [
        {
          id: 'wo-1', correlative: 'OT-100', status: 'CLOSED',
          closedAt: '2026-05-01T10:00:00.000Z', createdAt: '2026-04-30T10:00:00.000Z',
          parts: [
            { id: 'p1', partNumber: 'FIL-01', description: 'Filtro', quantity: 2, unitCost: 5000 },
            { id: 'p2', partNumber: 'ACE-10', description: 'Aceite', quantity: 1, unitCost: null },
          ],
        },
      ],
    } as any);

    expect(component.partsTotalCost()).toBe(10000);
  });

  it('partsConsumed queda vacío cuando no hay OTs con repuestos', () => {
    component['analytics'].set(MOCK_ANALYTICS);
    expect(component.partsConsumed()).toEqual([]);
    expect(component.partsTotalCost()).toBe(0);
  });

  // ── Sprint 2.2: Lifecycle cost (tab Costos) ──
  it('la pestaña "costos" existe en la lista de tabs', () => {
    expect(component.tabs.map((t) => t.id)).toContain('costos');
  });

  it('costTotal suma todos los AssetCostRecord y costByType desglosa por tipo', () => {
    component['analytics'].set({
      ...MOCK_ANALYTICS,
      assetCostRecords: [
        { id: 'c1', type: 'WORK_ORDER', amount: 30000, recordedAt: '2026-05-03T10:00:00Z', workOrder: { correlative: 'OT-1' } },
        { id: 'c2', type: 'PURCHASE',   amount: 50000, recordedAt: '2026-05-02T10:00:00Z', purchaseOrder: { correlative: 'OC-1' } },
        { id: 'c3', type: 'LUBE_DISPATCH', amount: 20000, recordedAt: '2026-05-01T10:00:00Z' },
      ],
    } as any);

    expect(component.costTotal()).toBe(100000);

    const byType = component.costByType();
    // Ordenado por monto desc: PURCHASE(50k) > WORK_ORDER(30k) > LUBE(20k).
    expect(byType.map((r) => r.type)).toEqual(['PURCHASE', 'WORK_ORDER', 'LUBE_DISPATCH']);
    expect(byType[0].pct).toBe(50);
  });

  it('costRecordsSorted ordena las imputaciones por fecha desc', () => {
    component['analytics'].set({
      ...MOCK_ANALYTICS,
      assetCostRecords: [
        { id: 'c1', type: 'WORK_ORDER', amount: 1, recordedAt: '2026-05-01T10:00:00Z' },
        { id: 'c2', type: 'PURCHASE',   amount: 1, recordedAt: '2026-05-10T10:00:00Z' },
      ],
    } as any);
    expect(component.costRecordsSorted().map((r) => r.id)).toEqual(['c2', 'c1']);
  });

  it('costTotal es 0 y costByType vacío sin registros de costo', () => {
    component['analytics'].set(MOCK_ANALYTICS);
    expect(component.costTotal()).toBe(0);
    expect(component.costByType()).toEqual([]);
  });

  it('bump de revisión del equipo vuelve a disparar getEquipmentAnalytics', () => {
    fixture.componentRef.setInput('equipmentId', 'eq-001');
    fixture.componentRef.setInput('isOpen', true);
    fixture.detectChanges();

    expect(fleetSpy.getEquipmentAnalytics).toHaveBeenCalledTimes(1);

    equipmentRevisionSignal('eq-001').set(1);
    fixture.detectChanges();

    expect(fleetSpy.getEquipmentAnalytics).toHaveBeenCalledTimes(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FASE 3 — Verificación del historial de horómetro en UI
// Testa el computed `meterHistoryRows` que transforma los EquipmentMeterLog
// crudos (con oldValue/newValue/source) en las filas procesadas que recibe
// la tabla presentacional (deltaFromPrevious + sourceLabel en español).
// ─────────────────────────────────────────────────────────────────────────────

describe('EquipmentDetailModalComponent — meterHistoryRows (Fase 3: historial UI)', () => {
  let component: EquipmentDetailModalComponent;
  let fixture: ComponentFixture<EquipmentDetailModalComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EquipmentDetailModalComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: FleetService,                    useValue: fleetSpy },
        { provide: FaultReportsService,             useValue: faultSpy },
        { provide: EquipmentAvailabilityService,    useValue: availSpy },
        { provide: LubeReportsService,              useValue: lubeSpy },
        { provide: WorkOrdersService,               useValue: workOrdersSpy },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(EquipmentDetailModalComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  // Payload del caos en terreno — orden DESC (más reciente primero), como viene de la API.
  // El computed debe sortear ASC internamente para calcular el delta correctamente.
  const CHAOS_LOGS_DESC: EquipmentMeterLog[] = [
    {
      id:       'log-fault',
      source:   'FAULT_REPORT',
      oldValue: 5050,
      newValue: 5100,
      date:     '2026-06-03T12:00:00Z',
      user:     { name: 'Juan Pérez' },
    },
    {
      id:       'log-avail',
      source:   'AVAILABILITY_REPORT',
      oldValue: 5000,
      newValue: 5050,
      date:     '2026-06-03T08:00:00Z',
      user:     { name: 'María López' },
    },
  ];

  /** Carga logs en analytics sin alterar el resto del fixture. */
  function loadLogs(logs: EquipmentMeterLog[]): void {
    component['analytics'].set({ ...MOCK_ANALYTICS, meterLogs: logs } as any);
  }

  // ── Estado vacío ───────────────────────────────────────────────────────────

  it('retorna array vacío cuando no hay logs de horómetro', () => {
    component['analytics'].set(MOCK_ANALYTICS); // meterLogs: []
    expect(component.meterHistoryRows()).toEqual([]);
  });

  // ── Cardinalidad ──────────────────────────────────────────────────────────

  it('retorna exactamente 2 filas para el escenario de los 2 logs del caos en terreno', () => {
    loadLogs(CHAOS_LOGS_DESC);
    expect(component.meterHistoryRows().length).toBe(2);
  });

  // ── Orden de la salida ────────────────────────────────────────────────────

  it('ordena la salida ASC por fecha aunque el input llegue DESC (más antiguo primero en el array)', () => {
    loadLogs(CHAOS_LOGS_DESC);
    const rows = component.meterHistoryRows();
    // rows[0] debe ser el log de las 08:00 (AVAILABILITY_REPORT)
    // rows[1] debe ser el log de las 12:00 (FAULT_REPORT)
    expect(rows[0].id).toBe('log-avail');
    expect(rows[1].id).toBe('log-fault');
  });

  // ── Cálculo del delta ─────────────────────────────────────────────────────

  it('Δ primera entrada: usa oldValue del propio log (5050 - 5000 = +50)', () => {
    loadLogs(CHAOS_LOGS_DESC);
    const rows = component.meterHistoryRows();
    // log-avail (i=0): reading=5050, prevReading=oldValue=5000 → delta=50
    expect(rows[0].deltaFromPrevious).toBe(50);
  });

  it('Δ segunda entrada: usa newValue del log anterior (5100 - 5050 = +50)', () => {
    loadLogs(CHAOS_LOGS_DESC);
    const rows = component.meterHistoryRows();
    // log-fault (i=1): reading=5100, prevReading=asc[0].newValue=5050 → delta=50
    expect(rows[1].deltaFromPrevious).toBe(50);
  });

  it('reading de cada fila corresponde a newValue del log', () => {
    loadLogs(CHAOS_LOGS_DESC);
    const rows = component.meterHistoryRows();
    expect(rows[0].reading).toBe(5050);
    expect(rows[1].reading).toBe(5100);
  });

  it('deltaFromPrevious es null cuando el cálculo no es finito (prevención de NaN)', () => {
    const logWithNaN: EquipmentMeterLog = {
      id: 'log-nan', source: 'MANUAL',
      oldValue: 'invalid' as any,
      newValue: 'invalid' as any,
      date: '2026-06-03T06:00:00Z',
    };
    loadLogs([logWithNaN]);
    expect(component.meterHistoryRows()[0].deltaFromPrevious).toBeNull();
  });

  // ── Traducción de fuentes (sourceLabel) ───────────────────────────────────

  it('FAULT_REPORT se traduce a "Reporte de falla"', () => {
    loadLogs(CHAOS_LOGS_DESC);
    const faultRow = component.meterHistoryRows().find(r => r.id === 'log-fault');
    expect(faultRow?.sourceLabel).toBe('Reporte de falla');
  });

  it('AVAILABILITY_REPORT se traduce a "Reporte de disponibilidad"', () => {
    loadLogs(CHAOS_LOGS_DESC);
    const availRow = component.meterHistoryRows().find(r => r.id === 'log-avail');
    expect(availRow?.sourceLabel).toBe('Reporte de disponibilidad');
  });

  it('MANUAL se traduce a "Manual / ajuste"', () => {
    loadLogs([{
      id: 'log-m', source: 'MANUAL',
      oldValue: 100, newValue: 200, date: '2026-06-03T06:00:00Z',
    }]);
    expect(component.meterHistoryRows()[0].sourceLabel).toBe('Manual / ajuste');
  });

  it('TELEMETRY se traduce a "Telemetría"', () => {
    loadLogs([{
      id: 'log-t', source: 'TELEMETRY',
      oldValue: 200, newValue: 300, date: '2026-06-03T06:00:00Z',
    }]);
    expect(component.meterHistoryRows()[0].sourceLabel).toBe('Telemetría');
  });

  it('OT incluye el correlativo en la etiqueta cuando está disponible', () => {
    loadLogs([{
      id: 'log-ot', source: 'OT',
      oldValue: 300, newValue: 350, date: '2026-06-03T06:00:00Z',
      workOrderCorrelative: 'OT-2026-005',
    }]);
    expect(component.meterHistoryRows()[0].sourceLabel).toBe('OT OT-2026-005');
  });

  it('OT sin correlativo retorna la etiqueta genérica "OT"', () => {
    loadLogs([{
      id: 'log-ot2', source: 'OT',
      oldValue: 300, newValue: 350, date: '2026-06-03T06:00:00Z',
    }]);
    expect(component.meterHistoryRows()[0].sourceLabel).toBe('OT');
  });

  // ── userLabel ─────────────────────────────────────────────────────────────

  it('userLabel usa el nombre del usuario cuando está disponible', () => {
    loadLogs(CHAOS_LOGS_DESC);
    expect(component.meterHistoryRows()[0].userLabel).toBe('María López');
    expect(component.meterHistoryRows()[1].userLabel).toBe('Juan Pérez');
  });

  it('userLabel usa el email cuando no hay nombre', () => {
    loadLogs([{
      id: 'log-e', source: 'MANUAL',
      oldValue: 100, newValue: 150, date: '2026-06-03T06:00:00Z',
      user: { email: 'admin@tpm.cl' },
    }]);
    expect(component.meterHistoryRows()[0].userLabel).toBe('admin@tpm.cl');
  });

  it('userLabel es "—" cuando el log no tiene usuario', () => {
    loadLogs([{
      id: 'log-u', source: 'MANUAL',
      oldValue: 100, newValue: 150, date: '2026-06-03T06:00:00Z',
    }]);
    expect(component.meterHistoryRows()[0].userLabel).toBe('—');
  });

  // ── meterHistoryPreviewRows ───────────────────────────────────────────────

  it('meterHistoryPreviewRows retorna todas las filas cuando hay 8 o menos', () => {
    loadLogs(CHAOS_LOGS_DESC); // 2 logs
    expect(component.meterHistoryPreviewRows().length).toBe(2);
  });

  it('meterHistoryPreviewRows limita a las últimas 8 entradas cuando hay más de 8 logs', () => {
    const manyLogs: EquipmentMeterLog[] = Array.from({ length: 12 }, (_, i) => ({
      id:       `log-${i}`,
      source:   'MANUAL' as const,
      oldValue: i * 100,
      newValue: (i + 1) * 100,
      date:     new Date(2026, 5, 1 + i).toISOString(),
    }));
    loadLogs(manyLogs);
    expect(component.meterHistoryRows().length).toBe(12);
    expect(component.meterHistoryPreviewRows().length).toBe(8);
  });

  it('meterHistoryPreviewRows son las 8 ÚLTIMAS filas (las más recientes)', () => {
    const manyLogs: EquipmentMeterLog[] = Array.from({ length: 12 }, (_, i) => ({
      id:       `log-${i}`,
      source:   'MANUAL' as const,
      oldValue: i * 100,
      newValue: (i + 1) * 100,
      date:     new Date(2026, 5, 1 + i).toISOString(),
    }));
    loadLogs(manyLogs);
    const preview = component.meterHistoryPreviewRows();
    // El slice(-8) toma los últimos 8 del array ASC → los 8 más recientes
    expect(preview[0].id).toBe('log-4');   // posición 4 en el array ASC
    expect(preview[7].id).toBe('log-11');  // el más reciente
  });
});
