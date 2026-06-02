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

  const lubeServiceSpy = jasmine.createSpyObj<LubeReportsService>('LubeReportsService', {
    getReports: of({ data: [], total: 0, page: 1, pageSize: 20 }),
  });

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
});
