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
  },
);

const notifySpy = jasmine.createSpyObj<NotificationService>('NotificationService', [
  'success',
  'error',
]);

const contractsSpy = jasmine.createSpyObj<ContractsService>('ContractsService', {
  findAll: of([]),
});

const authSpy = jasmine.createSpyObj<AuthService>('AuthService', [], {
  currentUser: signal({ role: 'ADMIN' as const, allowedContracts: ['ALL'] }),
});

const shiftSpy = jasmine.createSpyObj<ShiftService>('ShiftService', [], {
  todayIso: signal('2026-06-04'),
  currentShift: signal<'DAY' | 'NIGHT'>('DAY'),
  hasNightShift: signal(true),
});

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
          useValue: { snapshot: { queryParamMap: { get: () => null } } },
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
});
