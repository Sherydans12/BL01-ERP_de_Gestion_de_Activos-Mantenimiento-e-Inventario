import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { AvailabilityMonitorComponent } from './availability-monitor.component';
import {
  EquipmentAvailabilityService,
  UnreportedEquipment,
} from '../../../core/services/equipment-availability/equipment-availability.service';
import { FleetService, PaginatedEquipments } from '../../../core/services/fleet/fleet.service';
import { NotificationService } from '../../../core/services/notification/notification.service';

// ── Stubs ─────────────────────────────────────────────────────────────────────

const emptyFleet: PaginatedEquipments = { data: [], total: 5, page: 1, limit: 1 };

const fleetServiceSpy = jasmine.createSpyObj<FleetService>('FleetService', {
  getEquipments: of(emptyFleet),
});

const notifySpy = jasmine.createSpyObj<NotificationService>('NotificationService', [
  'success',
  'error',
]);

// ─────────────────────────────────────────────────────────────────────────────

describe('AvailabilityMonitorComponent — empty state (todos reportados)', () => {
  let component: AvailabilityMonitorComponent;
  let fixture: ComponentFixture<AvailabilityMonitorComponent>;

  const availabilityServiceEmptySpy = jasmine.createSpyObj<EquipmentAvailabilityService>(
    'EquipmentAvailabilityService',
    { getUnreported: of([]) },
  );

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AvailabilityMonitorComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: EquipmentAvailabilityService, useValue: availabilityServiceEmptySpy },
        { provide: FleetService,                 useValue: fleetServiceSpy },
        { provide: NotificationService,          useValue: notifySpy },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AvailabilityMonitorComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('debería crearse', () => {
    expect(component).toBeTruthy();
  });

  it('llama a getUnreported al inicializar', () => {
    expect(availabilityServiceEmptySpy.getUnreported).toHaveBeenCalled();
  });

  it('los filtros inician en: fecha = hoy, turno = DAY', () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(component.filterDate()).toBe(today);
    expect(component.filterShift()).toBe('DAY');
  });

  it('unreported inicia en array vacío después de respuesta vacía', () => {
    expect(component.unreported()).toEqual([]);
    expect(component.unreportedCount()).toBe(0);
  });

  it('allReported es true cuando unreported está vacío y ya se hizo la consulta', () => {
    expect(component.allReported()).toBeTrue();
  });

  it('isLoading es false una vez resuelta la consulta', () => {
    expect(component.isLoading()).toBeFalse();
  });

  it('lastQueried no es null después de la primera consulta', () => {
    expect(component.lastQueried()).not.toBeNull();
  });

  it('totalFleet se carga desde FleetService', () => {
    expect(component.totalFleet()).toBe(5);
  });

  it('reportedCount es igual a totalFleet cuando unreportedCount es 0', () => {
    expect(component.reportedCount()).toBe(5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('AvailabilityMonitorComponent — con equipos sin reportar (alerta)', () => {
  let component: AvailabilityMonitorComponent;
  let fixture: ComponentFixture<AvailabilityMonitorComponent>;

  const twoUnreported: UnreportedEquipment[] = [
    { id: 'eq-1', internalId: 'EQ-001', brand: 'CAT',    model: '330',   plate: 'A-001', contractId: 'c-1' },
    { id: 'eq-2', internalId: 'EQ-002', brand: 'Komatsu', model: 'PC200', plate: null,    contractId: 'c-1' },
  ];

  const availabilityServiceAlertSpy = jasmine.createSpyObj<EquipmentAvailabilityService>(
    'EquipmentAvailabilityService',
    { getUnreported: of(twoUnreported) },
  );

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AvailabilityMonitorComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: EquipmentAvailabilityService, useValue: availabilityServiceAlertSpy },
        { provide: FleetService,                 useValue: fleetServiceSpy },
        { provide: NotificationService,          useValue: notifySpy },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AvailabilityMonitorComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('debería crearse con equipos sin reportar', () => {
    expect(component).toBeTruthy();
  });

  it('unreportedCount es 2 cuando hay 2 equipos sin reporte', () => {
    expect(component.unreportedCount()).toBe(2);
  });

  it('allReported es false cuando hay equipos sin reporte', () => {
    expect(component.allReported()).toBeFalse();
  });

  it('unreported contiene los equipos correctos', () => {
    const ids = component.unreported().map((e) => e.id);
    expect(ids).toContain('eq-1');
    expect(ids).toContain('eq-2');
  });

  it('onShiftChange actualiza el signal de turno', () => {
    component.onShiftChange('NIGHT');
    expect(component.filterShift()).toBe('NIGHT');
  });

  it('onDateChange actualiza el signal de fecha', () => {
    component.onDateChange('2026-06-01');
    expect(component.filterDate()).toBe('2026-06-01');
  });

  it('reportedCount es totalFleet menos unreportedCount', () => {
    expect(component.reportedCount()).toBe(component.totalFleet() - 2);
  });
});
