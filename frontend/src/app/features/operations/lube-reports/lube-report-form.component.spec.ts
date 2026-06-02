import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { LubeReportFormComponent } from './lube-report-form.component';
import { LubeReportsService } from '../../../core/services/lube-reports/lube-reports.service';
import { WarehousesService } from '../../../core/services/warehouses/warehouses.service';
import { FleetService } from '../../../core/services/fleet/fleet.service';
import { InventoryItemsService } from '../../../core/services/inventory-items/inventory-items.service';

describe('LubeReportFormComponent', () => {
  let component: LubeReportFormComponent;
  let fixture: ComponentFixture<LubeReportFormComponent>;

  const lubeServiceSpy = jasmine.createSpyObj<LubeReportsService>('LubeReportsService', {
    createReport: of({} as any),
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

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LubeReportFormComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: LubeReportsService,      useValue: lubeServiceSpy },
        { provide: WarehousesService,       useValue: warehousesServiceSpy },
        { provide: FleetService,            useValue: fleetServiceSpy },
        { provide: InventoryItemsService,   useValue: inventoryItemsServiceSpy },
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
});
