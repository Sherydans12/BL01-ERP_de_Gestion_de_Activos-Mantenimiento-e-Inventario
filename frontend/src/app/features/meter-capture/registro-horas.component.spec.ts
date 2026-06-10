import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { of } from 'rxjs';

import { RegistroHorasComponent } from './registro-horas.component';
import { FleetService } from '../../core/services/fleet/fleet.service';
import { CatalogService } from '../../core/services/catalog/catalog.service';
import { ContractsService } from '../../core/services/contracts/contracts.service';
import { AuthService } from '../../core/services/auth/auth.service';
import { DeviceService } from '../../core/services/device/device.service';
import { NotificationService } from '../../core/services/notification/notification.service';
import {
  MeterCaptureBoardRow,
  MeterType,
} from '../../core/models/types';

const boardRow: MeterCaptureBoardRow = {
  id: 'eq-1',
  internalId: 'EQ-001',
  displayName: 'CAT 330',
  type: 'Camión',
  currentMeter: 1000,
  meterType: MeterType.HOURS,
  lastReadingAt: null,
  lastReadingSource: null,
  contractCode: 'C1',
  subcontractCode: null,
};

const fleetSpy = jasmine.createSpyObj<FleetService>('FleetService', {
  getMeterCaptureBoard: of({ limit: 1000, data: [boardRow] }),
  bulkSyncMeterReadings: of({
    successCount: 1,
    unchangedCount: 0,
    errors: [],
    applied: [
      {
        equipmentId: 'eq-1',
        internalId: 'EQ-001',
        from: 1000,
        to: 1025,
      },
    ],
  }),
  notifyEquipmentChanged: undefined,
});

const catalogSpy = jasmine.createSpyObj<CatalogService>(
  'CatalogService',
  ['loadCatalogs'],
);
catalogSpy.loadCatalogs.and.returnValue(of([]));
Object.defineProperty(catalogSpy, 'equipmentTypes', {
  value: signal([]),
});

const contractsSpy = jasmine.createSpyObj<ContractsService>('ContractsService', {
  findAll: of([]),
});

const authSpy = jasmine.createSpyObj<AuthService>('AuthService', [
  'hasPermission',
  'userPermissions',
]);
authSpy.hasPermission.and.returnValue(true);
authSpy.userPermissions.and.returnValue([]);
Object.defineProperty(authSpy, 'currentUser', {
  value: signal({ id: 'user-1', role: 'MECHANIC' }),
});

const notifySpy = jasmine.createSpyObj<NotificationService>('NotificationService', [
  'success',
  'error',
  'warning',
  'info',
]);

const deviceStub = {
  isMobile: signal(false),
};

describe('RegistroHorasComponent', () => {
  let component: RegistroHorasComponent;
  let fixture: ComponentFixture<RegistroHorasComponent>;

  beforeEach(async () => {
    fleetSpy.getMeterCaptureBoard.calls.reset();
    fleetSpy.bulkSyncMeterReadings.calls.reset();
    fleetSpy.notifyEquipmentChanged.calls.reset();
    notifySpy.error.calls.reset();
    deviceStub.isMobile.set(false);

    await TestBed.configureTestingModule({
      imports: [RegistroHorasComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: FleetService, useValue: fleetSpy },
        { provide: CatalogService, useValue: catalogSpy },
        { provide: ContractsService, useValue: contractsSpy },
        { provide: AuthService, useValue: authSpy },
        { provide: NotificationService, useValue: notifySpy },
        { provide: DeviceService, useValue: deviceStub },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(RegistroHorasComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('debería crearse y cargar el tablero', () => {
    expect(component).toBeTruthy();
    expect(fleetSpy.getMeterCaptureBoard).toHaveBeenCalled();
    expect(component.boardRows().length).toBe(1);
  });

  it('calcula el delta reactivo según la lectura ingresada', () => {
    component.updateReading('eq-1', '1025');
    expect(component.rowDelta(boardRow)).toBe(25);
    component.updateReading('eq-1', '1010');
    expect(component.rowDelta(boardRow)).toBe(10);
    component.updateReading('eq-1', '990');
    expect(component.rowDelta(boardRow)).toBe(-10);
    expect(component.rowHasInvalidReading(boardRow)).toBeTrue();
  });

  it('detecta salto alto solo cuando supera el umbral de horómetro (24)', () => {
    component.updateReading('eq-1', '1024');
    expect(component.rowNeedsJumpConfirm(boardRow)).toBeFalse();
    component.updateReading('eq-1', '1025');
    expect(component.rowNeedsJumpConfirm(boardRow)).toBeTrue();
  });

  it('muestra tabla en escritorio y tarjetas en móvil', () => {
    deviceStub.isMobile.set(false);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.meter-cap-table')).not.toBeNull();
    expect(el.querySelector('.meter-cap-cards')).toBeNull();

    deviceStub.isMobile.set(true);
    fixture.detectChanges();
    expect(el.querySelector('.meter-cap-cards')).not.toBeNull();
    expect(el.querySelector('.meter-cap-table')).toBeNull();
  });

  it('retiene el POST y abre el modal si hay saltos altos sin confirmar', () => {
    component.updateReading('eq-1', '1025');
    component.syncReadings();

    expect(fleetSpy.bulkSyncMeterReadings).not.toHaveBeenCalled();
    expect(component.showLargeJumpConfirmModal()).toBeTrue();
    expect(component.largeJumpPreviewRows().length).toBe(1);
    expect(component.largeJumpPreviewRows()[0].delta).toBe(25);
  });

  it('envía confirmedLargeJump tras confirmar el modal de salto alto', () => {
    component.updateReading('eq-1', '1025');
    component.syncReadings();
    expect(fleetSpy.bulkSyncMeterReadings).not.toHaveBeenCalled();

    component.onLargeJumpConfirmed();

    expect(fleetSpy.bulkSyncMeterReadings).toHaveBeenCalledWith(
      {
        items: [
          jasmine.objectContaining({
            equipmentId: 'eq-1',
            newReading: 1025,
            confirmedLargeJump: true,
          }),
        ],
      },
      jasmine.any(Object),
    );
  });

  it('sincroniza sin modal cuando el delta está dentro del umbral', () => {
    component.updateReading('eq-1', '1010');
    component.syncReadings();

    expect(component.showLargeJumpConfirmModal()).toBeFalse();
    expect(fleetSpy.bulkSyncMeterReadings).toHaveBeenCalledWith(
      {
        items: [
          jasmine.objectContaining({
            equipmentId: 'eq-1',
            newReading: 1010,
          }),
        ],
      },
      jasmine.any(Object),
    );
    const call = fleetSpy.bulkSyncMeterReadings.calls.mostRecent().args[0];
    expect(call.items[0].confirmedLargeJump).toBeUndefined();
  });

  it('notifica a Flota por cada equipo con lectura aplicada', () => {
    component.updateReading('eq-1', '1010');
    component.syncReadings();

    expect(fleetSpy.notifyEquipmentChanged).toHaveBeenCalledWith('eq-1');
  });
});
