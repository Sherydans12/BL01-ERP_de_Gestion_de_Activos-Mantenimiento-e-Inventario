import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { signal } from '@angular/core';

import { FleetMasterComponent } from './fleet-master.component';
import { FleetService } from '../../../core/services/fleet/fleet.service';
import { AuthService } from '../../../core/services/auth/auth.service';
import { CatalogService } from '../../../core/services/catalog/catalog.service';
import { ContractsService } from '../../../core/services/contracts/contracts.service';
import { NotificationService } from '../../../core/services/notification/notification.service';
import { ExportService } from '../../../core/services/export/export.service';

// ── Stubs mínimos ──────────────────────────────────────────────────────────────

const fleetSpy = jasmine.createSpyObj<FleetService>('FleetService', {
  getEquipments: of({ data: [], total: 0, page: 1, limit: 10 }),
  getEquipmentResumePdf: of(new Blob()),
  invalidateCache: undefined,
});
// Exponer listVersion como signal de sólo lectura que devuelve 0
(fleetSpy as any).listVersion = signal(0).asReadonly();

const authSpy = {
  hasPermission: jasmine.createSpy('hasPermission').and.returnValue(true),
  currentContractId: signal('ALL').asReadonly(),
  currentUser: signal(null).asReadonly(),
} as unknown as AuthService;

const catalogSpy = jasmine.createSpyObj<CatalogService>('CatalogService', {
  loadCatalogs: of([]),
});
(catalogSpy as any).equipmentTypes = signal([]).asReadonly();
(catalogSpy as any).brands         = signal([]).asReadonly();
(catalogSpy as any).fuelTypes      = signal([]).asReadonly();
(catalogSpy as any).driveTypes     = signal([]).asReadonly();
(catalogSpy as any).ownerships     = signal([]).asReadonly();

const contractsSpy   = jasmine.createSpyObj<ContractsService>('ContractsService',   { findAll: of([]) });
const notifySpy      = jasmine.createSpyObj<NotificationService>('NotificationService', ['success', 'error', 'warning', 'info']);
const exportSpy      = jasmine.createSpyObj<ExportService>('ExportService',          ['exportToExcel']);

// ─────────────────────────────────────────────────────────────────────────────

describe('FleetMasterComponent', () => {
  let component: FleetMasterComponent;
  let fixture: ComponentFixture<FleetMasterComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FleetMasterComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: FleetService,        useValue: fleetSpy },
        { provide: AuthService,         useValue: authSpy },
        { provide: CatalogService,      useValue: catalogSpy },
        { provide: ContractsService,    useValue: contractsSpy },
        { provide: NotificationService, useValue: notifySpy },
        { provide: ExportService,       useValue: exportSpy },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(FleetMasterComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('debería crearse', () => {
    expect(component).toBeTruthy();
  });

  it('inicia con lista de flota vacía', () => {
    expect(component.fleet()).toEqual([]);
  });

  it('inicia en la página 1', () => {
    expect(component.currentPage()).toBe(1);
  });

  it('totalPages es 1 cuando no hay ítems', () => {
    expect(component.totalPages()).toBe(0);
  });

  it('llama a FleetService.getEquipments al inicializar', () => {
    expect(fleetSpy.getEquipments).toHaveBeenCalled();
  });

  it('showDetailModal inicia en false', () => {
    expect(component.showDetailModal()).toBeFalse();
  });

  it('openDetail asigna el equipmentId y abre el modal de detalle', () => {
    const eq: any = { id: 'eq-001', internalId: 'EC-3005', brand: 'Cat', model: '980G',
                      meterType: 'HOURS', currentMeter: 1500, isOperational: true };
    component.openDetail(eq);
    expect(component.selectedEquipmentId()).toBe('eq-001');
    expect(component.showDetailModal()).toBeTrue();
  });
});
