import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl } from '@angular/forms';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { LubeReportFormComponent } from './lube-report-form.component';
import { LubeReportsService } from '../../../core/services/lube-reports/lube-reports.service';
import { WarehousesService } from '../../../core/services/warehouses/warehouses.service';
import { FleetService } from '../../../core/services/fleet/fleet.service';
import { InventoryItemsService } from '../../../core/services/inventory-items/inventory-items.service';
import { EquipmentMeterSnapshotService } from '../../../core/services/equipment-meter/equipment-meter-snapshot.service';
import { NotificationService } from '../../../core/services/notification/notification.service';
import { MeterType } from '../../../core/models/types';

const METER_SNAPSHOT = {
  equipmentId: 'eq-1',
  currentMeter: 4500,
  meterType: MeterType.HOURS,
  internalId: 'EQ-1',
  lastLog: {
    date: '2026-06-01T08:00:00.000Z',
    source: 'MANUAL' as const,
    sourceId: null,
    otCorrelative: null,
    userName: 'Operador',
  },
};

describe('LubeReportFormComponent', () => {
  let component: LubeReportFormComponent;
  let fixture: ComponentFixture<LubeReportFormComponent>;

  const lubeServiceSpy = jasmine.createSpyObj<LubeReportsService>('LubeReportsService', {
    createReport: of({ correlative: 'RCL-00001' } as any),
  });

  const warehousesServiceSpy = jasmine.createSpyObj<WarehousesService>('WarehousesService', {
    getWarehouses: of([]),
  });

  const fleetServiceSpy = jasmine.createSpyObj<FleetService>('FleetService', {
    getEquipments: of({ data: [], total: 0, page: 1, limit: 200 }),
  });

  const inventoryItemsServiceSpy = jasmine.createSpyObj<InventoryItemsService>(
    'InventoryItemsService',
    { getCategoryFamilies: of([]) },
  );

  const meterSnapSpy = jasmine.createSpyObj<EquipmentMeterSnapshotService>(
    'EquipmentMeterSnapshotService',
    { getSnapshot: of(METER_SNAPSHOT) },
  );

  const notifySpy = jasmine.createSpyObj<NotificationService>('NotificationService', [
    'success',
    'error',
  ]);

  beforeEach(async () => {
    meterSnapSpy.getSnapshot.calls.reset();

    await TestBed.configureTestingModule({
      imports: [LubeReportFormComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: LubeReportsService, useValue: lubeServiceSpy },
        { provide: WarehousesService, useValue: warehousesServiceSpy },
        { provide: FleetService, useValue: fleetServiceSpy },
        { provide: InventoryItemsService, useValue: inventoryItemsServiceSpy },
        { provide: EquipmentMeterSnapshotService, useValue: meterSnapSpy },
        { provide: NotificationService, useValue: notifySpy },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LubeReportFormComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('debería crearse', () => {
    expect(component).toBeTruthy();
  });

  it('inicia con el formulario vacío: sin líneas ni equipo seleccionado', () => {
    expect(component.lines()).toEqual([]);
    expect(component.selectedEquipmentId()).toBe('');
    expect(component.selectedWarehouseId()).toBe('');
  });

  it('isFormValid es false cuando no hay líneas', () => {
    expect(component.isFormValid()).toBeFalse();
  });

  it('confirmLeaveIfDirty retorna true si no hay líneas (sin bloquear navegación)', () => {
    const result = component.confirmLeaveIfDirty();
    expect(result).toBeTrue();
  });

  it('carga snapshot una sola vez al seleccionar equipo', () => {
    component.onEquipmentChange('eq-1');
    expect(meterSnapSpy.getSnapshot).toHaveBeenCalledTimes(1);
    expect(meterSnapSpy.getSnapshot).toHaveBeenCalledWith('eq-1');
    expect(component.meterSnapshot()?.currentMeter).toBe(4500);

    component.onEquipmentChange('eq-1');
    expect(meterSnapSpy.getSnapshot).toHaveBeenCalledTimes(1);
  });

  it('meterReadingInvalid y canSubmit bloquean lectura regresiva', () => {
    component.onEquipmentChange('eq-1');
    component.meterReading.set(4400);
    expect(component.meterReadingInvalid()).toBeTrue();
    expect(component.canSubmit()).toBeFalse();
  });

  it('submit no envía si el horómetro es menor al actual', () => {
    component.onEquipmentChange('eq-1');
    component.selectedWarehouseId.set('wh-1');
    component.selectedContractId.set('c-1');
    component.dispatchDate.set('2026-06-03');
    component.lines.set([
      {
        itemId: 'item-1',
        name: 'Aceite',
        partNumber: null,
        inventoryCode: null,
        unitAbbr: 'L',
        allowsDecimals: false,
        stockAvailable: 10,
        quantityControl: new FormControl(1),
        confirmedLargeDispatch: false,
      },
    ]);
    component.meterReading.set(1000);
    component.submit();
    expect(lubeServiceSpy.createReport).not.toHaveBeenCalled();
    expect(notifySpy.error).toHaveBeenCalled();
  });
});
