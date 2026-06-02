import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { AvailabilityFormComponent } from './availability-form.component';
import {
  EquipmentAvailabilityService,
  AvailabilityRecord,
} from '../../../core/services/equipment-availability/equipment-availability.service';
import { FleetService } from '../../../core/services/fleet/fleet.service';
import { NotificationService } from '../../../core/services/notification/notification.service';

// ── Stubs ────────────────────────────────────────────────────────────────────

const availabilityServiceSpy = jasmine.createSpyObj<EquipmentAvailabilityService>(
  'EquipmentAvailabilityService',
  { create: of({} as AvailabilityRecord) },
);

const fleetServiceSpy = jasmine.createSpyObj<FleetService>('FleetService', {
  getEquipments: of({ data: [], total: 0, page: 1, limit: 300 }),
});

const notifySpy = jasmine.createSpyObj<NotificationService>('NotificationService', [
  'success',
  'error',
]);

// ─────────────────────────────────────────────────────────────────────────────

describe('AvailabilityFormComponent', () => {
  let component: AvailabilityFormComponent;
  let fixture: ComponentFixture<AvailabilityFormComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AvailabilityFormComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: EquipmentAvailabilityService, useValue: availabilityServiceSpy },
        { provide: FleetService,                 useValue: fleetServiceSpy },
        { provide: NotificationService,          useValue: notifySpy },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AvailabilityFormComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('debería crearse', () => {
    expect(component).toBeTruthy();
  });

  it('inicia con los valores por defecto: Turno Día, estado OPERATIONAL, sin equipo', () => {
    expect(component.selectedEquipmentId()).toBe('');
    expect(component.shift()).toBe('DAY');
    expect(component.status()).toBe('OPERATIONAL');
    expect(component.meterReading()).toBeNull();
    expect(component.comments()).toBe('');
  });

  it('reportDate inicia en la fecha de hoy (formato YYYY-MM-DD)', () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(component.reportDate()).toBe(today);
  });

  it('isFormValid es false cuando no hay equipo seleccionado', () => {
    expect(component.isFormValid()).toBeFalse();
  });

  it('isFormValid es true cuando se selecciona un equipo', () => {
    component.onSelectEquipment('equipo-uuid-1234');
    expect(component.isFormValid()).toBeTrue();
  });

  it('isDirty es false en el estado inicial', () => {
    expect(component.isDirty()).toBeFalse();
  });

  it('isDirty es true cuando se selecciona un equipo', () => {
    component.onSelectEquipment('equipo-uuid-1234');
    expect(component.isDirty()).toBeTrue();
  });

  it('confirmLeaveIfDirty retorna true (sin bloquear navegación) si no hay datos', () => {
    const result = component.confirmLeaveIfDirty();
    expect(result).toBeTrue();
  });

  it('confirmLeaveIfDirty abre el modal de confirmación cuando hay datos sin guardar', () => {
    component.onSelectEquipment('equipo-uuid-1234');
    component.confirmLeaveIfDirty();
    expect(component.leaveConfirmOpen()).toBeTrue();
  });

  it('llama a FleetService.getEquipments al inicializar', () => {
    expect(fleetServiceSpy.getEquipments).toHaveBeenCalled();
  });

  it('equipLoading es false después de cargar la flota', () => {
    expect(component.equipLoading()).toBeFalse();
  });

  it('resetForm limpia todos los signals al estado inicial', () => {
    component.onSelectEquipment('equipo-uuid-1234');
    component.shift.set('NIGHT');
    component.meterReading.set(1500);
    component.comments.set('Observación de prueba');

    component.resetForm();

    expect(component.selectedEquipmentId()).toBe('');
    expect(component.shift()).toBe('DAY');
    expect(component.meterReading()).toBeNull();
    expect(component.comments()).toBe('');
  });
});
