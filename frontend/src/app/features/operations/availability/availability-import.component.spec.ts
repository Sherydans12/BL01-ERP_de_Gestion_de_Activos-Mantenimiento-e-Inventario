import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';

import { AvailabilityImportComponent } from './availability-import.component';
import {
  EquipmentAvailabilityService,
  ImportCommitResult,
  ImportValidationResult,
} from '../../../core/services/equipment-availability/equipment-availability.service';
import { NotificationService } from '../../../core/services/notification/notification.service';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const previewStub: ImportValidationResult = {
  reportDate: '2026-06-03',
  shift: 'DAY',
  rows: [
    {
      rowNum: 2,
      equipmentId: 'eq-1',
      equipmentLabel: 'ABC-123 · CAT 330 (EQ-001)',
      status: 'OPERATIONAL',
      statusLabel: 'Operativo',
      meterReading: 1200,
      comments: null,
      action: 'CREATE',
      currentStatus: null,
      currentMeter: 1100,
      meterUnit: 'hrs' as const,
      warning: null,
      error: null,
    },
    {
      rowNum: 3,
      equipmentId: 'eq-2',
      equipmentLabel: 'XYZ-789 · Komatsu PC200 (EQ-002)',
      status: 'DOWN_FAILURE',
      statusLabel: 'Detenido por Falla',
      meterReading: null,
      comments: 'Falla hidráulica',
      action: 'UPDATE',
      currentStatus: 'OPERATIONAL',
      currentMeter: 2400,
      meterUnit: 'hrs' as const,
      warning: null,
      error: null,
    },
    {
      rowNum: 4,
      equipmentId: 'eq-3',
      equipmentLabel: 'DEF-456 · Volvo EC300 (EQ-003)',
      status: 'OPERATIONAL',
      statusLabel: 'Operativo',
      meterReading: null,
      comments: null,
      action: 'SKIP',
      currentStatus: 'OPERATIONAL',
      currentMeter: 500,
      meterUnit: 'km' as const,
      warning: null,
      error: null,
    },
  ],
  summary: { total: 3, toCreate: 1, toUpdate: 1, withErrors: 0, toSkip: 1, withWarnings: 0 },
};

const previewWithErrorsStub: ImportValidationResult = {
  ...previewStub,
  rows: [
    ...previewStub.rows,
    {
      rowNum: 5,
      equipmentId: 'bad-uuid',
      equipmentLabel: 'bad-uuid',
      status: null,
      statusLabel: '',
      meterReading: null,
      comments: null,
      action: 'ERROR',
      currentStatus: null,
      currentMeter: null,
      meterUnit: 'hrs' as const,
      warning: null,
      error: 'Equipo no encontrado en este tenant.',
    },
  ],
  summary: { total: 4, toCreate: 1, toUpdate: 1, withErrors: 1, toSkip: 1, withWarnings: 0 },
};

const commitResultStub: ImportCommitResult = {
  committed: 2,
  errors: [],
};

// ── Stubs ─────────────────────────────────────────────────────────────────────

const availabilityServiceSpy = jasmine.createSpyObj<EquipmentAvailabilityService>(
  'EquipmentAvailabilityService',
  {
    exportTemplate: of(void 0),
    validateImport: of(previewStub),
    commitImport: of(commitResultStub),
  },
);

const notifySpy = jasmine.createSpyObj<NotificationService>('NotificationService', [
  'success',
  'error',
  'warning',
]);

// ─────────────────────────────────────────────────────────────────────────────

describe('AvailabilityImportComponent', () => {
  let component: AvailabilityImportComponent;
  let fixture: ComponentFixture<AvailabilityImportComponent>;

  beforeEach(async () => {
    availabilityServiceSpy.exportTemplate.calls.reset();
    availabilityServiceSpy.validateImport.calls.reset();
    availabilityServiceSpy.commitImport.calls.reset();
    notifySpy.error.calls.reset();
    notifySpy.success.calls.reset();

    // Reset return values to defaults
    availabilityServiceSpy.exportTemplate.and.returnValue(of(void 0));
    availabilityServiceSpy.validateImport.and.returnValue(of(previewStub));
    availabilityServiceSpy.commitImport.and.returnValue(of(commitResultStub));

    await TestBed.configureTestingModule({
      imports: [AvailabilityImportComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: EquipmentAvailabilityService, useValue: availabilityServiceSpy },
        { provide: NotificationService, useValue: notifySpy },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AvailabilityImportComponent);
    component = fixture.componentInstance;
  });

  it('debería crearse el componente', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('pageState inicial es "idle"', () => {
    expect(component.pageState()).toBe('idle');
  });

  it('reportDate inicial coincide con la fecha de hoy en formato ISO', () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(component.reportDate()).toBe(today);
  });

  it('shift inicial es "DAY"', () => {
    expect(component.shift()).toBe('DAY');
  });

  it('canCommit es false cuando preview es null', () => {
    expect(component.preview()).toBeNull();
    expect(component.canCommit()).toBe(false);
  });

  it('canCommit es true cuando preview tiene toCreate > 0', () => {
    component.preview.set(previewStub);
    expect(component.canCommit()).toBe(true);
  });

  it('canCommit es false cuando preview solo tiene SKIPs y ERRORs', () => {
    component.preview.set({
      ...previewStub,
      summary: { total: 2, toCreate: 0, toUpdate: 0, withErrors: 1, toSkip: 1, withWarnings: 0 },
    });
    expect(component.canCommit()).toBe(false);
  });

  it('hasErrors es true cuando el resumen tiene withErrors > 0', () => {
    component.preview.set(previewWithErrorsStub);
    expect(component.hasErrors()).toBe(true);
  });

  it('commitCount calcula la suma de toCreate + toUpdate', () => {
    component.preview.set(previewStub);
    expect(component.commitCount()).toBe(2); // 1 CREATE + 1 UPDATE
  });

  it('exportTemplate llama al servicio con los valores actuales de fecha y turno', () => {
    component.reportDate.set('2026-06-03');
    component.shift.set('NIGHT');

    component.exportTemplate();

    expect(availabilityServiceSpy.exportTemplate).toHaveBeenCalledWith(
      '2026-06-03',
      'NIGHT',
    );
  });

  it('exportTemplate muestra error si el servicio falla', () => {
    availabilityServiceSpy.exportTemplate.and.returnValue(throwError(() => new Error('net')));

    component.exportTemplate();

    expect(notifySpy.error).toHaveBeenCalled();
    expect(component.isExporting()).toBe(false);
  });

  it('resetToIdle vuelve el pageState a "idle" y limpia preview', () => {
    component.pageState.set('preview');
    component.preview.set(previewStub);

    component.resetToIdle();

    expect(component.pageState()).toBe('idle');
    expect(component.preview()).toBeNull();
    expect(component.commitResult()).toBeNull();
  });

  it('commitImport no hace nada si canCommit es false', () => {
    component.preview.set(null);

    component.commitImport();

    expect(availabilityServiceSpy.commitImport).not.toHaveBeenCalled();
  });

  it('commitImport transiciona a "done" tras éxito y almacena commitResult', () => {
    component.preview.set(previewStub);
    component.pageState.set('preview');

    component.commitImport();

    expect(component.pageState()).toBe('done');
    expect(component.commitResult()).toEqual(commitResultStub);
    // Solo envía filas CREATE y UPDATE (no SKIP)
    expect(availabilityServiceSpy.commitImport).toHaveBeenCalledWith(
      '2026-06-03',
      'DAY',
      jasmine.arrayWithExactContents([
        jasmine.objectContaining({ equipmentId: 'eq-1', status: 'OPERATIONAL' }),
        jasmine.objectContaining({ equipmentId: 'eq-2', status: 'DOWN_FAILURE' }),
      ]),
    );
  });

  it('commitImport vuelve a "preview" y muestra error si el servicio falla', () => {
    availabilityServiceSpy.commitImport.and.returnValue(
      throwError(() => ({ error: { message: 'DB error' } })),
    );
    component.preview.set(previewStub);
    component.pageState.set('preview');

    component.commitImport();

    expect(component.pageState()).toBe('preview');
    expect(notifySpy.error).toHaveBeenCalled();
  });
});
