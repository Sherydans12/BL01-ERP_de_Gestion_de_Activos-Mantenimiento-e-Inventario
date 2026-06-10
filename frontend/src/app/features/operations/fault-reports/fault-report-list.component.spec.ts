import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { FaultReportListComponent } from './fault-report-list.component';
import {
  FaultReportsService,
  FaultReportRow,
  FaultReportListResponse,
} from '../../../core/services/fault-reports/fault-reports.service';
import { FleetService } from '../../../core/services/fleet/fleet.service';
import { NotificationService } from '../../../core/services/notification/notification.service';

// ── Datos de prueba ───────────────────────────────────────────────────────────

const MOCK_ROW: FaultReportRow = {
  id: 'rf-uuid-001',
  correlative: 'RF-00001',
  eventDate: '2026-06-02T10:00:00.000Z',
  meterAtFault: 12500,
  affectedSystem: 'MOTOR',
  criticality: 'LOW',
  symptomDescription: 'Ruido inusual durante el arranque en frío',
  status: 'OPEN',
  workOrderId: null,
  createdAt: '2026-06-02T10:05:00.000Z',
  equipment: {
    id: 'eq-uuid-001',
    internalId: 'EQ-001',
    brand: 'Caterpillar',
    model: '980G',
    plate: 'AB-1234',
    isOperational: true,
  },
  reportedBy: { id: 'usr-001', name: 'Juan Operador' },
  workOrder: null,
};

const EMPTY_RESPONSE: FaultReportListResponse = {
  data: [],
  total: 0,
  page: 1,
  pageSize: 20,
};

const POPULATED_RESPONSE: FaultReportListResponse = {
  data: [MOCK_ROW],
  total: 1,
  page: 1,
  pageSize: 20,
};

// ── Stubs ─────────────────────────────────────────────────────────────────────

const faultServiceSpy = jasmine.createSpyObj<FaultReportsService>(
  'FaultReportsService',
  {
    getReports:      of(EMPTY_RESPONSE),
    createWorkOrder: of({ ...MOCK_ROW, status: 'LINKED' as const }),
  },
);

const fleetServiceSpy = jasmine.createSpyObj<FleetService>('FleetService', {
  getEquipments: of({ data: [], total: 0, page: 1, limit: 200 }),
});

const notifySpy = jasmine.createSpyObj<NotificationService>('NotificationService', [
  'success',
  'error',
]);

// ─────────────────────────────────────────────────────────────────────────────

describe('FaultReportListComponent', () => {
  let component: FaultReportListComponent;
  let fixture: ComponentFixture<FaultReportListComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FaultReportListComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: FaultReportsService, useValue: faultServiceSpy },
        { provide: FleetService,        useValue: fleetServiceSpy },
        { provide: NotificationService, useValue: notifySpy },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(FaultReportListComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('debería crearse', () => {
    expect(component).toBeTruthy();
  });

  it('llama a getReports al inicializar', () => {
    expect(faultServiceSpy.getReports).toHaveBeenCalled();
  });

  it('llama a FleetService.getEquipments al inicializar', () => {
    expect(fleetServiceSpy.getEquipments).toHaveBeenCalled();
  });

  it('inicia con page = 1, rows vacíos y total = 0', () => {
    expect(component.page()).toBe(1);
    expect(component.rows()).toEqual([]);
    expect(component.total()).toBe(0);
  });

  it('loading es false después de recibir la respuesta inicial', () => {
    expect(component.loading()).toBeFalse();
  });

  it('generatingOtForId inicia en null', () => {
    expect(component.generatingOtForId()).toBeNull();
  });

  it('todos los filtros inician vacíos', () => {
    expect(component.filterEquipmentId()).toBe('');
    expect(component.filterCriticality()).toBe('');
    expect(component.filterStatus()).toBe('');
    expect(component.filterDateFrom()).toBe('');
    expect(component.filterDateTo()).toBe('');
  });

  it('clearFilters restablece filtros y vuelve a page 1', () => {
    component.filterCriticality.set('HIGH');
    component.filterStatus.set('OPEN');
    component.page.set(3);

    component.clearFilters();

    expect(component.filterCriticality()).toBe('');
    expect(component.filterStatus()).toBe('');
    expect(component.page()).toBe(1);
  });

  it('totalPages es 1 cuando la lista está vacía', () => {
    expect(component.totalPages()).toBe(1);
  });

  describe('con datos precargados', () => {
    beforeEach(() => {
      component.rows.set([MOCK_ROW]);
      component.total.set(1);
      fixture.detectChanges();
    });

    it('equipmentLabel retorna la etiqueta correcta del equipo', () => {
      const label = component.equipmentLabel(MOCK_ROW);
      expect(label).toContain('EQ-001');
      expect(label).toContain('Caterpillar');
      expect(label).toContain('980G');
    });

    it('equipmentLabel incluye la placa si está presente', () => {
      const label = component.equipmentLabel(MOCK_ROW);
      expect(label).toContain('AB-1234');
    });
  });
});
