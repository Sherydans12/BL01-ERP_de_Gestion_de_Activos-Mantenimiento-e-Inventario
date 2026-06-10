import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { LubeReportListComponent } from './lube-report-list.component';
import { LubeReportsService } from '../../../core/services/lube-reports/lube-reports.service';
import { WarehousesService } from '../../../core/services/warehouses/warehouses.service';
import { FleetService } from '../../../core/services/fleet/fleet.service';

describe('LubeReportListComponent', () => {
  let component: LubeReportListComponent;
  let fixture: ComponentFixture<LubeReportListComponent>;

  const lubeServiceSpy = jasmine.createSpyObj<LubeReportsService>(
    'LubeReportsService',
    ['getReports', 'getReport'],
  );
  lubeServiceSpy.getReports.and.returnValue(
    of({ data: [], total: 0, page: 1, pageSize: 25 }),
  );

  const warehousesServiceSpy = jasmine.createSpyObj<WarehousesService>('WarehousesService', {
    getWarehouses: of([]),
  });

  const fleetServiceSpy = jasmine.createSpyObj<FleetService>('FleetService', {
    getEquipments: of({ data: [], total: 0, page: 1, limit: 20 }),
  });

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LubeReportListComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: LubeReportsService,  useValue: lubeServiceSpy },
        { provide: WarehousesService,   useValue: warehousesServiceSpy },
        { provide: FleetService,        useValue: fleetServiceSpy },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LubeReportListComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('debería crearse', () => {
    expect(component).toBeTruthy();
  });

  it('llama a getReports al inicializar', () => {
    expect(lubeServiceSpy.getReports).toHaveBeenCalled();
  });

  it('inicia con page = 1 y rows vacíos', () => {
    expect(component.page()).toBe(1);
    expect(component.rows()).toEqual([]);
    expect(component.total()).toBe(0);
  });

  it('abre modal de detalle al solicitar un reporte', () => {
    lubeServiceSpy.getReport.and.returnValue(
      of({
        id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        correlative: 'RCL-00001',
        dispatchDate: '2026-06-01',
        meterReading: 100,
        notes: null,
        createdAt: '2026-06-01',
        equipment: { id: 'e', internalId: 'EQ-1', brand: 'X', model: 'Y', plate: null },
        warehouse: { id: 'w', code: 'B1', name: 'Bodega' },
        user: { id: 'u', name: 'Op' },
        lines: [],
      } as any),
    );
    component.openDetail('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
    expect(lubeServiceSpy.getReport).toHaveBeenCalledWith(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    );
    expect(component.detailOpen()).toBeTrue();
  });
});
