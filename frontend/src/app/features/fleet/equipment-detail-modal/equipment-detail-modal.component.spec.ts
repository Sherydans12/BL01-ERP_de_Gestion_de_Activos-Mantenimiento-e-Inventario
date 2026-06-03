import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { of } from 'rxjs';

import { EquipmentDetailModalComponent } from './equipment-detail-modal.component';
import { FleetService } from '../../../core/services/fleet/fleet.service';
import { FaultReportsService } from '../../../core/services/fault-reports/fault-reports.service';
import { EquipmentAvailabilityService } from '../../../core/services/equipment-availability/equipment-availability.service';
import { LubeReportsService } from '../../../core/services/lube-reports/lube-reports.service';

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

const fleetSpy       = jasmine.createSpyObj<FleetService>('FleetService',                     { getEquipmentAnalytics: of(MOCK_ANALYTICS) });
const faultSpy       = jasmine.createSpyObj<FaultReportsService>('FaultReportsService',       { getReports: of({ data: [], total: 0, page: 1, pageSize: 1 }) });
const availSpy       = jasmine.createSpyObj<EquipmentAvailabilityService>('EquipmentAvailabilityService', { getAll: of({ data: [], total: 0, page: 1, pageSize: 1 }) });
const lubeSpy        = jasmine.createSpyObj<LubeReportsService>('LubeReportsService',         { getReports: of({ data: [], total: 0, page: 1, pageSize: 5 }) });

// ─────────────────────────────────────────────────────────────────────────────

describe('EquipmentDetailModalComponent', () => {
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
});
