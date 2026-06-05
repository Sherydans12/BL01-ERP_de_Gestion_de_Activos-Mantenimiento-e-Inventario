import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { AvailabilityMonitorComponent } from './availability-monitor.component';
import {
  EquipmentAvailabilityService,
  ShiftBoardResponse,
} from '../../../core/services/equipment-availability/equipment-availability.service';
import { ContractsService } from '../../../core/services/contracts/contracts.service';
import { NotificationService } from '../../../core/services/notification/notification.service';
import { AuthService } from '../../../core/services/auth/auth.service';
import { ShiftService } from '../../../core/services/shift/shift.service';

const boardEmpty: ShiftBoardResponse = {
  date: '2026-06-04',
  shift: 'DAY',
  summary: {
    totalFleet: 5,
    reportedCount: 5,
    unreportedCount: 0,
    excludedDownCount: 0,
    completionPct: 100,
    byStatus: {
      OPERATIONAL: 5,
      STANDBY: 0,
      RESERVE_NO_OPERATOR: 0,
      DOWN_FAILURE: 0,
      DOWN_MAINTENANCE: 0,
    },
    byContract: [],
  },
  rows: [],
  total: 0,
  page: 1,
  pageSize: 25,
};

const availabilityServiceSpy = jasmine.createSpyObj<EquipmentAvailabilityService>(
  'EquipmentAvailabilityService',
  {
    getShiftBoard: of(boardEmpty),
    exportTemplate: of(undefined),
    hasPendingFaultRegistration: false,
  },
);

const contractsSpy = jasmine.createSpyObj<ContractsService>('ContractsService', {
  findAll: of([]),
});

const authSpy = jasmine.createSpyObj<AuthService>('AuthService', [], {
  currentUser: signal({
    id: 'usr-admin',
    email: 'admin@test.cl',
    name: 'Admin',
    role: 'ADMIN' as const,
    allowedContracts: ['ALL'],
  }),
});

const shiftSpy = jasmine.createSpyObj<ShiftService>('ShiftService', [], {
  todayIso: signal('2026-06-04'),
  currentShift: signal<'DAY' | 'NIGHT'>('DAY'),
  hasNightShift: signal(true),
  shiftLabel: signal('Turno Día'),
  shiftHours: signal('08:00–20:00'),
});

const notifySpy = jasmine.createSpyObj<NotificationService>('NotificationService', [
  'success',
  'error',
]);

describe('AvailabilityMonitorComponent', () => {
  let component: AvailabilityMonitorComponent;
  let fixture: ComponentFixture<AvailabilityMonitorComponent>;

  beforeEach(async () => {
    availabilityServiceSpy.getShiftBoard.and.returnValue(of(boardEmpty));

    await TestBed.configureTestingModule({
      imports: [AvailabilityMonitorComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: EquipmentAvailabilityService, useValue: availabilityServiceSpy },
        { provide: ContractsService, useValue: contractsSpy },
        { provide: AuthService, useValue: authSpy },
        { provide: ShiftService, useValue: shiftSpy },
        { provide: NotificationService, useValue: notifySpy },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AvailabilityMonitorComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('debería crearse y consultar shift-board al iniciar', () => {
    expect(component).toBeTruthy();
    expect(availabilityServiceSpy.getShiftBoard).toHaveBeenCalled();
  });

  it('muestra summary con flota al 100%', () => {
    expect(component.summary()?.reportedCount).toBe(5);
    expect(component.summary()?.unreportedCount).toBe(0);
  });
});

describe('AvailabilityMonitorComponent — pendientes', () => {
  let component: AvailabilityMonitorComponent;
  let fixture: ComponentFixture<AvailabilityMonitorComponent>;

  const boardPending: ShiftBoardResponse = {
    ...boardEmpty,
    summary: {
      ...boardEmpty.summary,
      reportedCount: 1,
      unreportedCount: 2,
      completionPct: 33,
      byStatus: { ...boardEmpty.summary.byStatus, OPERATIONAL: 1 },
    },
    rows: [
      {
        equipmentId: 'eq-2',
        internalId: 'EQ-002',
        brand: 'Komatsu',
        model: 'PC200',
        plate: null,
        contractId: 'c-1',
        isOperational: true,
        rowKind: 'PENDING',
      },
    ],
    total: 1,
  };

  beforeEach(async () => {
    availabilityServiceSpy.getShiftBoard.and.returnValue(of(boardPending));

    await TestBed.configureTestingModule({
      imports: [AvailabilityMonitorComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: EquipmentAvailabilityService, useValue: availabilityServiceSpy },
        { provide: ContractsService, useValue: contractsSpy },
        { provide: AuthService, useValue: authSpy },
        { provide: ShiftService, useValue: shiftSpy },
        { provide: NotificationService, useValue: notifySpy },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AvailabilityMonitorComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('lista equipos pendientes del turno', () => {
    expect(component.rows().length).toBe(1);
    expect(component.rows()[0].rowKind).toBe('PENDING');
  });
});
