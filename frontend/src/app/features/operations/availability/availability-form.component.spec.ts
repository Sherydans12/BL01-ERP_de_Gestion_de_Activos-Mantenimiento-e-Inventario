import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { AvailabilityFormComponent } from './availability-form.component';
import {
  EquipmentAvailabilityService,
  AvailabilityRecord,
  UnreportedEquipment,
} from '../../../core/services/equipment-availability/equipment-availability.service';
import { NotificationService } from '../../../core/services/notification/notification.service';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const twoEquipments: UnreportedEquipment[] = [
  { id: 'eq-1', internalId: 'EQ-001', brand: 'CAT',    model: '330',   plate: 'A-001', contractId: 'c-1' },
  { id: 'eq-2', internalId: 'EQ-002', brand: 'Komatsu', model: 'PC200', plate: null,    contractId: 'c-1' },
];

// ── Stubs ─────────────────────────────────────────────────────────────────────

const availabilityServiceSpy = jasmine.createSpyObj<EquipmentAvailabilityService>(
  'EquipmentAvailabilityService',
  {
    getUnreported: of(twoEquipments),
    create: of({} as AvailabilityRecord),
  },
);

const notifySpy = jasmine.createSpyObj<NotificationService>('NotificationService', [
  'success',
  'error',
]);

// ─────────────────────────────────────────────────────────────────────────────

describe('AvailabilityFormComponent (Bulk Grid)', () => {
  let component: AvailabilityFormComponent;
  let fixture: ComponentFixture<AvailabilityFormComponent>;

  beforeEach(async () => {
    availabilityServiceSpy.getUnreported.calls.reset();
    availabilityServiceSpy.create.calls.reset();
    notifySpy.success.calls.reset();
    notifySpy.error.calls.reset();

    await TestBed.configureTestingModule({
      imports: [AvailabilityFormComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: EquipmentAvailabilityService, useValue: availabilityServiceSpy },
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

  it('inicia con fecha de hoy y Turno Día', () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(component.reportDate()).toBe(today);
    expect(component.shift()).toBe('DAY');
  });

  it('llama a getUnreported al inicializar', () => {
    expect(availabilityServiceSpy.getUnreported).toHaveBeenCalledWith({
      date: jasmine.any(String),
      shift: 'DAY',
    });
  });

  it('isLoadingEquipments es false después de cargar la lista', () => {
    expect(component.isLoadingEquipments()).toBeFalse();
  });

  it('pendingEquipments contiene los equipos devueltos por el servicio', () => {
    expect(component.pendingEquipments().length).toBe(2);
    expect(component.pendingEquipments()[0].id).toBe('eq-1');
  });

  it('drafts se inicializa con status null por cada equipo pendiente', () => {
    const d = component.drafts();
    expect(d['eq-1']).toEqual({ status: null, meterReading: null, comments: '' });
    expect(d['eq-2']).toEqual({ status: null, meterReading: null, comments: '' });
  });

  it('isDirty es false cuando todos los drafts están vacíos', () => {
    expect(component.isDirty()).toBeFalse();
  });

  it('isDirty es true cuando se actualiza el status de cualquier equipo', () => {
    component.updateDraft('eq-1', { status: 'OPERATIONAL' });
    expect(component.isDirty()).toBeTrue();
  });

  it('readyCount es 0 cuando ningún equipo tiene status', () => {
    expect(component.readyCount()).toBe(0);
  });

  it('readyCount es 1 cuando solo un equipo tiene status asignado', () => {
    component.updateDraft('eq-1', { status: 'OPERATIONAL' });
    expect(component.readyCount()).toBe(1);
  });

  it('readyCount es 2 cuando ambos equipos tienen status', () => {
    component.updateDraft('eq-1', { status: 'OPERATIONAL' });
    component.updateDraft('eq-2', { status: 'DOWN_FAILURE' });
    expect(component.readyCount()).toBe(2);
  });

  it('updateDraft actualiza un campo sin perder los otros del mismo equipo', () => {
    component.updateDraft('eq-1', { meterReading: 1500 });
    component.updateDraft('eq-1', { status: 'OPERATIONAL' });
    const d = component.drafts()['eq-1'];
    expect(d.meterReading).toBe(1500);
    expect(d.status).toBe('OPERATIONAL');
    expect(d.comments).toBe('');
  });

  it('updateDraft no afecta el draft de otro equipo', () => {
    component.updateDraft('eq-1', { status: 'DOWN_FAILURE' });
    expect(component.drafts()['eq-2'].status).toBeNull();
  });

  it('confirmLeaveIfDirty retorna true (sin bloquear) si no hay datos', () => {
    const result = component.confirmLeaveIfDirty();
    expect(result).toBeTrue();
  });

  it('confirmLeaveIfDirty abre el modal cuando hay datos sin guardar', () => {
    component.updateDraft('eq-1', { status: 'DOWN_FAILURE' });
    component.confirmLeaveIfDirty();
    expect(component.leaveConfirmOpen()).toBeTrue();
  });

  it('submitAll llama a create para cada equipo con status asignado (forkJoin)', () => {
    component.updateDraft('eq-1', { status: 'OPERATIONAL' });
    component.updateDraft('eq-2', { status: 'DOWN_FAILURE' });
    component.submitAll();
    expect(availabilityServiceSpy.create).toHaveBeenCalledTimes(2);
  });

  it('submitAll no llama a create si ningún equipo tiene status', () => {
    component.submitAll();
    expect(availabilityServiceSpy.create).not.toHaveBeenCalled();
  });

  it('submitAll solo envía los equipos que tienen status (no todos)', () => {
    component.updateDraft('eq-1', { status: 'STANDBY' });
    component.submitAll();
    expect(availabilityServiceSpy.create).toHaveBeenCalledTimes(1);
    const call = availabilityServiceSpy.create.calls.first();
    expect(call.args[0].equipmentId).toBe('eq-1');
    expect(call.args[0].status).toBe('STANDBY');
  });

  it('submitAll pasa meterReading y comments del draft al payload', () => {
    component.updateDraft('eq-1', { status: 'OPERATIONAL', meterReading: 9999, comments: 'Test' });
    component.submitAll();
    const payload = availabilityServiceSpy.create.calls.first().args[0];
    expect(payload.meterReading).toBe(9999);
    expect(payload.comments).toBe('Test');
  });
});
