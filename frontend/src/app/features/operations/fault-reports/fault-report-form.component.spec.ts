import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, ActivatedRoute } from '@angular/router';
import { of } from 'rxjs';

import { FaultReportFormComponent } from './fault-report-form.component';
import {
  FaultReportsService,
  FaultReportRow,
} from '../../../core/services/fault-reports/fault-reports.service';
import { FleetService } from '../../../core/services/fleet/fleet.service';
import { EquipmentAvailabilityService } from '../../../core/services/equipment-availability/equipment-availability.service';
import { NotificationService } from '../../../core/services/notification/notification.service';
import { EquipmentMeterSnapshotService } from '../../../core/services/equipment-meter/equipment-meter-snapshot.service';
import { MeterType } from '../../../core/models/types';

const METER_SNAPSHOT = {
  equipmentId: 'eq-uuid-001',
  currentMeter: 12500,
  meterType: MeterType.HOURS,
  internalId: 'EQ-001',
  lastLog: null,
};

// ── Stubs ─────────────────────────────────────────────────────────────────────

const MOCK_REPORT: FaultReportRow = {
  id: 'rf-uuid-001',
  correlative: 'RF-00001',
  eventDate: new Date().toISOString(),
  meterAtFault: null,
  affectedSystem: 'MOTOR',
  criticality: 'LOW',
  symptomDescription: 'Ruido inusual en el motor',
  status: 'OPEN',
  workOrderId: null,
  createdAt: new Date().toISOString(),
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

const faultServiceSpy = jasmine.createSpyObj<FaultReportsService>(
  'FaultReportsService',
  { create: of(MOCK_REPORT) },
);

const fleetServiceSpy = jasmine.createSpyObj<FleetService>('FleetService', {
  getEquipments: of({ data: [], total: 0, page: 1, limit: 300 }),
  notifyEquipmentChanged: undefined,
});

const availabilitySpy = jasmine.createSpyObj<EquipmentAvailabilityService>(
  'EquipmentAvailabilityService',
  ['clearPendingFaultRegistration'],
);

const notifySpy = jasmine.createSpyObj<NotificationService>('NotificationService', [
  'success',
  'error',
]);

const meterSnapSpy = jasmine.createSpyObj<EquipmentMeterSnapshotService>(
  'EquipmentMeterSnapshotService',
  { getSnapshot: of(METER_SNAPSHOT) },
);

// ─────────────────────────────────────────────────────────────────────────────

describe('FaultReportFormComponent', () => {
  let component: FaultReportFormComponent;
  let fixture: ComponentFixture<FaultReportFormComponent>;

  beforeEach(async () => {
    faultServiceSpy.create.calls.reset();
    faultServiceSpy.create.and.returnValue(of(MOCK_REPORT));
    availabilitySpy.clearPendingFaultRegistration.calls.reset();
    notifySpy.success.calls.reset();
    notifySpy.error.calls.reset();
    meterSnapSpy.getSnapshot.calls.reset();

    await TestBed.configureTestingModule({
      imports: [FaultReportFormComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: { get: () => null } } },
        },
        { provide: FaultReportsService, useValue: faultServiceSpy },
        { provide: FleetService,        useValue: fleetServiceSpy },
        { provide: EquipmentAvailabilityService, useValue: availabilitySpy },
        { provide: NotificationService, useValue: notifySpy },
        { provide: EquipmentMeterSnapshotService, useValue: meterSnapSpy },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(FaultReportFormComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('debería crearse', () => {
    expect(component).toBeTruthy();
  });

  it('inicia con todos los campos en blanco y sin equipo seleccionado', () => {
    expect(component.selectedEquipmentId()).toBe('');
    expect(component.selectedSystem()).toBe('');
    expect(component.selectedCriticality()).toBe('');
    expect(component.symptomDescription()).toBe('');
    expect(component.meterAtFault()).toBeNull();
  });

  it('equipLoading es false después de recibir la lista de flota', () => {
    expect(component.equipLoading()).toBeFalse();
  });

  it('llama a FleetService.getEquipments al inicializar', () => {
    expect(fleetServiceSpy.getEquipments).toHaveBeenCalled();
  });

  it('isFormValid es false cuando no hay datos ingresados', () => {
    expect(component.isFormValid()).toBeFalse();
  });

  it('isFormValid es false cuando la descripción tiene menos de 10 caracteres', () => {
    component.onSelectEquipment('eq-uuid-001');
    component.selectedSystem.set('MOTOR');
    component.selectedCriticality.set('LOW');
    component.symptomDescription.set('corto');
    expect(component.isFormValid()).toBeFalse();
  });

  it('isFormValid es true cuando todos los campos requeridos están completos', () => {
    component.onSelectEquipment('eq-uuid-001');
    component.selectedSystem.set('MOTOR');
    component.selectedCriticality.set('LOW');
    component.symptomDescription.set('Ruido inusual en el motor durante arranque en frío');
    expect(component.isFormValid()).toBeTrue();
  });

  it('isDirty es false en el estado inicial', () => {
    expect(component.isDirty()).toBeFalse();
  });

  it('isDirty es true cuando se selecciona un equipo', () => {
    component.onSelectEquipment('eq-uuid-001');
    expect(component.isDirty()).toBeTrue();
  });

  it('isDirty es true cuando se ingresa una descripción', () => {
    component.symptomDescription.set('Falla en hidráulico');
    expect(component.isDirty()).toBeTrue();
  });

  it('confirmLeaveIfDirty retorna true si no hay datos sin guardar', () => {
    const result = component.confirmLeaveIfDirty();
    expect(result).toBeTrue();
  });

  it('confirmLeaveIfDirty abre el modal cuando hay datos sin guardar', () => {
    component.onSelectEquipment('eq-uuid-001');
    component.confirmLeaveIfDirty();
    expect(component.leaveConfirmOpen()).toBeTrue();
  });

  it('onSelectEquipment asigna el equipo y limpia la búsqueda', () => {
    component.equipSearch.set('Caterpillar');
    component.onSelectEquipment('eq-uuid-001');
    expect(component.selectedEquipmentId()).toBe('eq-uuid-001');
    expect(component.equipSearch()).toBe('');
  });

  it('carga snapshot una sola vez al seleccionar equipo', () => {
    meterSnapSpy.getSnapshot.calls.reset();
    component.onSelectEquipment('eq-uuid-001');
    expect(meterSnapSpy.getSnapshot).toHaveBeenCalledTimes(1);
    component.onSelectEquipment('eq-uuid-001');
    expect(meterSnapSpy.getSnapshot).toHaveBeenCalledTimes(1);
    expect(component.meterSnapshot()?.currentMeter).toBe(12500);
  });

  it('muestra alerta si meterAtFault es inferior al currentMeter del snapshot', () => {
    component.onSelectEquipment('eq-uuid-001');
    component.meterAtFault.set(12000);
    expect(component.meterAtFaultBelowCurrent()).toBeTrue();
    expect(component.meterAtFaultRegressiveMessage()).toContain('12.500');
    expect(component.meterAtFaultRegressiveMessage()).toContain('verifique');
  });

  it('limpia pendiente M2 al guardar una falla HIGH', () => {
    const highReport: FaultReportRow = { ...MOCK_REPORT, criticality: 'HIGH', status: 'LINKED' };
    faultServiceSpy.create.and.returnValue(of(highReport));

    component.onSelectEquipment('eq-uuid-001');
    component.selectedSystem.set('MOTOR');
    component.selectedCriticality.set('HIGH');
    component.symptomDescription.set('Motor fundido — equipo detenido de urgencia');
    component.submit();

    expect(availabilitySpy.clearPendingFaultRegistration).toHaveBeenCalledWith('eq-uuid-001');
  });

  it('limpia pendiente M2 al guardar una falla LOW', () => {
    faultServiceSpy.create.and.returnValue(of(MOCK_REPORT)); // LOW por defecto

    component.onSelectEquipment('eq-uuid-001');
    component.selectedSystem.set('TIRES_TRACKS');
    component.selectedCriticality.set('LOW');
    component.symptomDescription.set('Pequeña fuga de aire en neumático trasero derecho');
    component.submit();

    expect(availabilitySpy.clearPendingFaultRegistration).toHaveBeenCalledWith('eq-uuid-001');
  });

  it('resetForm limpia todos los signals al estado vacío', () => {
    component.onSelectEquipment('eq-uuid-001');
    component.selectedSystem.set('MOTOR');
    component.selectedCriticality.set('HIGH');
    component.symptomDescription.set('Motor fundido completamente');
    component.meterAtFault.set(15000);

    component.resetForm();

    expect(component.selectedEquipmentId()).toBe('');
    expect(component.selectedSystem()).toBe('');
    expect(component.selectedCriticality()).toBe('');
    expect(component.symptomDescription()).toBe('');
    expect(component.meterAtFault()).toBeNull();
  });
});
