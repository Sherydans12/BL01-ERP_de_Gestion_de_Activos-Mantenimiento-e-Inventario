import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, ActivatedRoute } from '@angular/router';
import { of } from 'rxjs';

import { AvailabilityFormComponent } from './availability-form.component';
import {
  EquipmentAvailabilityService,
  UnreportedEquipment,
} from '../../../core/services/equipment-availability/equipment-availability.service';
import { NotificationService } from '../../../core/services/notification/notification.service';
import { ContractsService } from '../../../core/services/contracts/contracts.service';
import { AuthService } from '../../../core/services/auth/auth.service';
import { ShiftService } from '../../../core/services/shift/shift.service';

const twoEquipments: UnreportedEquipment[] = [
  { id: 'eq-1', internalId: 'EQ-001', brand: 'CAT', model: '330', plate: 'A-001', contractId: 'c-1' },
  { id: 'eq-2', internalId: 'EQ-002', brand: 'Komatsu', model: 'PC200', plate: null, contractId: 'c-1' },
];

const paginatedResponse = {
  data: twoEquipments,
  total: 2,
  page: 1,
  pageSize: 10,
};

const availabilityServiceSpy = jasmine.createSpyObj<EquipmentAvailabilityService>(
  'EquipmentAvailabilityService',
  {
    getUnreported: of(paginatedResponse),
    batchCreate: of({ committed: 1, errors: [] }),
    markPendingFaultRegistration: undefined,
  },
);

const notifySpy = jasmine.createSpyObj<NotificationService>('NotificationService', [
  'success',
  'error',
]);

const contractsSpy = jasmine.createSpyObj<ContractsService>('ContractsService', {
  findAll: of([]),
});

const authSpy = jasmine.createSpyObj<AuthService>(
  'AuthService',
  { hasPermission: true, hasPermissionAny: true },
  {
    currentUser: signal({
      id: 'usr-admin',
      email: 'admin@test.cl',
      name: 'Admin',
      role: 'ADMIN' as const,
      allowedContracts: ['ALL'],
    }),
    userPermissions: signal<string[]>([]),
  },
);

const shiftSpy = jasmine.createSpyObj<ShiftService>(
  'ShiftService',
  {
    coerceShift: 'DAY',
    alignShiftAfterConfigLoad: 'DAY',
  },
  {
    todayIso: signal('2026-06-04'),
    currentShift: signal<'DAY' | 'NIGHT'>('DAY'),
    hasNightShift: signal(true),
    operationalConfigLoaded: signal(true),
  },
);

describe('AvailabilityFormComponent (Bulk Grid)', () => {
  let component: AvailabilityFormComponent;
  let fixture: ComponentFixture<AvailabilityFormComponent>;

  beforeEach(async () => {
    availabilityServiceSpy.getUnreported.calls.reset();
    availabilityServiceSpy.batchCreate.calls.reset();

    await TestBed.configureTestingModule({
      imports: [AvailabilityFormComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              queryParamMap: { get: () => null, has: () => false },
            },
          },
        },
        { provide: EquipmentAvailabilityService, useValue: availabilityServiceSpy },
        { provide: NotificationService, useValue: notifySpy },
        { provide: ContractsService, useValue: contractsSpy },
        { provide: AuthService, useValue: authSpy },
        { provide: ShiftService, useValue: shiftSpy },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AvailabilityFormComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('debería crearse', () => {
    expect(component).toBeTruthy();
  });

  it('llama a getUnreported paginado al inicializar', () => {
    expect(availabilityServiceSpy.getUnreported).toHaveBeenCalledWith(
      jasmine.objectContaining({ shift: 'DAY', page: 1, pageSize: 10 }),
    );
  });

  it('pendingEquipments contiene los equipos devueltos por el servicio', () => {
    expect(component.pendingEquipments().length).toBe(2);
    expect(component.pendingTotal()).toBe(2);
  });

  it('submitAll usa batchCreate en lugar de create individual', () => {
    component.updateDraft('eq-1', { status: 'OPERATIONAL' });
    component.submitAll();
    expect(availabilityServiceSpy.batchCreate).toHaveBeenCalledTimes(1);
  });

  it('muestra confirm modal cuando batchCreate devuelve sideEffects con requiresFaultCompletion', () => {
    availabilityServiceSpy.batchCreate.and.returnValue(
      of({
        committed: 1,
        errors: [],
        sideEffects: [
          {
            equipmentId: 'eq-1',
            status: 'DOWN_FAILURE',
            isOperational: false,
            createdFaultReport: true,
            requiresFaultCompletion: true,
            faultReportId: 'fr-1',
          },
        ],
      }),
    );

    component.updateDraft('eq-1', {
      status: 'DOWN_FAILURE',
      comments: 'Fuga hidráulica en bomba principal',
      meterReading: 12450,
    });
    component.submitAll();

    expect(component.faultCompletionConfirmOpen()).toBeTrue();
  });
});
