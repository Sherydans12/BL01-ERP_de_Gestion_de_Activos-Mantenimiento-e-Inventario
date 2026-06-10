import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { signal } from '@angular/core';
import { of } from 'rxjs';

import { WorkOrderFormComponent } from './work-order-form.component';
import { WorkOrdersService } from '../../../core/services/work-orders/work-orders.service';
import { FleetService } from '../../../core/services/fleet/fleet.service';
import {
  FaultReportsService,
  FaultReportRow,
} from '../../../core/services/fault-reports/fault-reports.service';
import { NotificationService } from '../../../core/services/notification/notification.service';
import { WarehousesService } from '../../../core/services/warehouses/warehouses.service';
import { InventoryItemsService } from '../../../core/services/inventory-items/inventory-items.service';
import { InventoryStockService } from '../../../core/services/inventory-stock/inventory-stock.service';
import { MaintenanceKitsService } from '../../../core/services/maintenance-kits/maintenance-kits.service';
import { EquipmentMeterSnapshotService } from '../../../core/services/equipment-meter/equipment-meter-snapshot.service';
import { CatalogService } from '../../../core/services/catalog/catalog.service';
import { AuthService } from '../../../core/services/auth/auth.service';
import { UsersService } from '../../../core/services/users/users.service';
import { MeterType } from '../../../core/models/types';

const METER_SNAPSHOT = {
  equipmentId: 'eq-001',
  currentMeter: 1500,
  meterType: MeterType.HOURS,
  internalId: 'EC-3005',
  lastLog: {
    date: '2026-06-01T10:00:00.000Z',
    source: 'OT' as const,
    sourceId: 'wo-prev',
    otCorrelative: 'OT-2026-010',
    userName: 'Mecánico',
  },
};

// ── Stubs ──────────────────────────────────────────────────────────────────────

const EQ: any = {
  id: 'eq-001',
  internalId: 'EC-3005',
  brand: 'Caterpillar',
  model: '980G',
  type: 'Cargador',
  meterType: 'HOURS',
  currentMeter: 1500,
  initialMeter: 0,
  isOperational: true,
  contractId: 'contract-1',
};

const OPEN_FAULT: FaultReportRow = {
  id: 'rf-001',
  correlative: 'RF-00010',
  eventDate: new Date().toISOString(),
  meterAtFault: null,
  affectedSystem: 'MOTOR',
  criticality: 'HIGH',
  symptomDescription: 'Pérdida de potencia notoria en pendiente',
  status: 'OPEN',
  workOrderId: null,
  createdAt: new Date().toISOString(),
  equipment: {
    id: 'eq-001',
    internalId: 'EC-3005',
    brand: 'Caterpillar',
    model: '980G',
    plate: 'AB-1234',
    isOperational: true,
  },
  reportedBy: { id: 'u-1', name: 'Operador' },
  workOrder: null,
};

const woSpy = jasmine.createSpyObj('WorkOrdersService', {
  getWorkOrdersFiltered: of({ data: [], total: 0 }),
  patchWorkOrder: of({}),
  updateStatus: of({}),
});
const fleetSpy = jasmine.createSpyObj('FleetService', {
  getEquipments: of({ data: [EQ], total: 1, page: 1, limit: 1000 }),
  notifyEquipmentChanged: undefined,
});
const faultSpy = jasmine.createSpyObj('FaultReportsService', {
  getReports: of({ data: [OPEN_FAULT], total: 1, page: 1, pageSize: 5 }),
});
const notifySpy = jasmine.createSpyObj('NotificationService', ['success', 'error']);
const warehousesSpy = jasmine.createSpyObj('WarehousesService', {
  getWarehousesByContract: of([]),
});
const invItemsSpy = jasmine.createSpyObj('InventoryItemsService', ['getItems']);
const invStockSpy = jasmine.createSpyObj('InventoryStockService', {
  getStockByWarehouse: of([]),
});
const kitsSpy = jasmine.createSpyObj('MaintenanceKitsService', {
  getKits: of([]),
});
const meterSnapSpy = jasmine.createSpyObj('EquipmentMeterSnapshotService', {
  getSnapshot: of(METER_SNAPSHOT),
});
const catalogSpy = jasmine.createSpyObj('CatalogService', {
  loadCatalogs: of([]),
  getAllCatalogs: () => signal([]),
});
Object.defineProperty(catalogSpy, 'systems', {
  value: signal([]),
});
const authSpy = {
  currentUser: signal(null).asReadonly(),
  userPermissions: signal<string[]>([]).asReadonly(),
  hasPermission: jasmine.createSpy('hasPermission').and.returnValue(true),
  hasPermissionAny: jasmine.createSpy('hasPermissionAny').and.returnValue(true),
} as unknown as AuthService;
const usersSpy = jasmine.createSpyObj('UsersService', {
  getAssignableForOt: of([]),
});

const activatedRouteStub = {
  paramMap: of(convertToParamMap({})),
  snapshot: { paramMap: convertToParamMap({}) },
};

// ─────────────────────────────────────────────────────────────────────────────

describe('WorkOrderFormComponent — banner fallas OPEN (1.3)', () => {
  let component: WorkOrderFormComponent;

  beforeEach(async () => {
    faultSpy.getReports.calls.reset();
    woSpy.patchWorkOrder.calls.reset();
    woSpy.updateStatus.calls.reset();
    fleetSpy.notifyEquipmentChanged.calls.reset();

    await TestBed.configureTestingModule({
      imports: [WorkOrderFormComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ActivatedRoute,                useValue: activatedRouteStub },
        { provide: WorkOrdersService,             useValue: woSpy },
        { provide: FleetService,                  useValue: fleetSpy },
        { provide: FaultReportsService,           useValue: faultSpy },
        { provide: NotificationService,           useValue: notifySpy },
        { provide: WarehousesService,             useValue: warehousesSpy },
        { provide: InventoryItemsService,         useValue: invItemsSpy },
        { provide: InventoryStockService,         useValue: invStockSpy },
        { provide: MaintenanceKitsService,        useValue: kitsSpy },
        { provide: EquipmentMeterSnapshotService, useValue: meterSnapSpy },
        { provide: CatalogService,                useValue: catalogSpy },
        { provide: AuthService,                   useValue: authSpy },
        { provide: UsersService,                  useValue: usersSpy },
      ],
    }).compileComponents();

    // Instanciar sin renderizar el template (componente muy grande): probamos la lógica.
    component = TestBed.createComponent(WorkOrderFormComponent).componentInstance;
    spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    component.ngOnInit();
  });

  it('debería crearse', () => {
    expect(component).toBeTruthy();
  });

  it('openFaults inicia vacío antes de seleccionar equipo', () => {
    // ngOnInit aún no seleccionó equipo (el form arranca con equipmentId vacío).
    expect(component.openFaults()).toEqual([]);
  });

  it('al seleccionar un equipo consulta fallas OPEN y llena el banner', () => {
    component.otForm.get('equipmentId')?.setValue('eq-001');

    expect(faultSpy.getReports).toHaveBeenCalledWith(
      jasmine.objectContaining({ equipmentId: 'eq-001', status: 'OPEN', pageSize: 5 }),
    );
    expect(component.openFaults().length).toBe(1);
    expect(component.openFaults()[0].correlative).toBe('RF-00010');
  });

  it('al cambiar a un equipo desconocido vacía el banner de fallas', () => {
    component.otForm.get('equipmentId')?.setValue('eq-001');
    expect(component.openFaults().length).toBe(1);

    // Equipo que no está en la flota cargada → rama de limpieza.
    component.otForm.get('equipmentId')?.setValue('eq-inexistente');
    expect(component.openFaults()).toEqual([]);
  });

  it('notifica a Flota al cerrar una OT con medidor final', () => {
    component.mode = 'EDITING';
    component.otId = 'wo-1';
    component.otForm.patchValue({
      equipmentId: 'eq-001',
      detentionStartedAt: '2026-06-01T08:00',
      detentionInitialMeter: 1500,
      detentionFinalMeter: 1510,
      mechanicAttentionStartedAt: '2026-06-01T08:30',
      mechanicAttentionEndedAt: '2026-06-01T10:00',
      affectsAvailability: 'SI',
      symptomsText: 'Ruido anormal',
      workPerformedDescription: 'Inspección y prueba operacional',
      responsibleMechanicName: 'Mecánico',
    });

    component.closeWorkOrderAfterOperationalAnswer(true);

    expect(woSpy.updateStatus).toHaveBeenCalledWith(
      'wo-1',
      'CLOSED',
      undefined,
      true,
      false,
      false,
    );
    expect(fleetSpy.notifyEquipmentChanged).toHaveBeenCalledWith('eq-001');
  });

  // ── Sprint 2.3: stock disponible al agregar repuestos ──
  describe('stock de repuestos', () => {
    beforeEach(() => {
      // Setear bodega (dispara getStockByWarehouse → []) y luego cargar stock manual.
      component.otForm.get('warehouseId')?.setValue('wh-1');
      component.warehouseStocks.set([
        { itemId: 'item-A', availableQuantity: 10, quantity: 12 },
        { itemId: 'item-B', availableQuantity: 0, quantity: 0 },
      ]);
    });

    it('stockForItem devuelve el disponible del ítem en la bodega de consumo', () => {
      expect(component.stockForItem('item-A')).toBe(10);
      expect(component.stockForItem('item-B')).toBe(0);
    });

    it('stockForItem devuelve null sin bodega seleccionada', () => {
      component.otForm.get('warehouseId')?.setValue('');
      expect(component.stockForItem('item-A')).toBeNull();
    });

    it('partRowHasShortage es true cuando la cantidad supera el stock', () => {
      component.addPartRow();
      const ctrl = component.partsArray.at(0);
      ctrl.patchValue({ inventoryItemId: 'item-A', quantity: 15 });
      expect(component.partRowHasShortage(ctrl)).toBeTrue();
    });

    it('partRowHasShortage es false cuando hay stock suficiente', () => {
      component.addPartRow();
      const ctrl = component.partsArray.at(0);
      ctrl.patchValue({ inventoryItemId: 'item-A', quantity: 5 });
      expect(component.partRowHasShortage(ctrl)).toBeFalse();
    });

    it('anyPartStockShortage detecta faltante en alguna línea (stock 0)', () => {
      component.addPartRow();
      component.partsArray.at(0).patchValue({ inventoryItemId: 'item-B', quantity: 1 });
      expect(component.anyPartStockShortage()).toBeTrue();
    });
  });
});

describe('WorkOrderFormComponent — banner medidor OT', () => {
  let component: WorkOrderFormComponent;

  beforeEach(async () => {
    meterSnapSpy.getSnapshot.and.returnValue(of(METER_SNAPSHOT));
    fleetSpy.notifyEquipmentChanged.calls.reset();

    await TestBed.configureTestingModule({
      imports: [WorkOrderFormComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ActivatedRoute, useValue: activatedRouteStub },
        { provide: WorkOrdersService, useValue: woSpy },
        { provide: FleetService, useValue: fleetSpy },
        { provide: FaultReportsService, useValue: faultSpy },
        { provide: NotificationService, useValue: notifySpy },
        { provide: WarehousesService, useValue: warehousesSpy },
        { provide: InventoryItemsService, useValue: invItemsSpy },
        { provide: InventoryStockService, useValue: invStockSpy },
        { provide: MaintenanceKitsService, useValue: kitsSpy },
        { provide: EquipmentMeterSnapshotService, useValue: meterSnapSpy },
        { provide: CatalogService, useValue: catalogSpy },
        { provide: AuthService, useValue: authSpy },
        { provide: UsersService, useValue: usersSpy },
      ],
    }).compileComponents();

    component = TestBed.createComponent(WorkOrderFormComponent).componentInstance;
    spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    component.ngOnInit();
    component.otForm.get('equipmentId')?.setValue('eq-001');
  });

  it('carga snapshot al seleccionar equipo (fuente para app-meter-reference-banner)', () => {
    expect(meterSnapSpy.getSnapshot).toHaveBeenCalledWith('eq-001');
    expect(component.meterSnapshot()?.currentMeter).toBe(1500);
    expect(component.meterSnapshot()?.lastLog?.source).toBe('OT');
  });

  it('canCloseOt es false si el medidor final es regresivo', () => {
    component.mode = 'EDITING';
    component.otId = 'wo-1';
    component.otForm.patchValue({
      detentionStartedAt: '2026-06-01T08:00',
      detentionInitialMeter: 1500,
      detentionFinalMeter: 1400,
    });
    expect(component.detentionFinalMeterInvalid()).toBeTrue();
    expect(component.canCloseOt()).toBeFalse();
  });

  it('initialMeterContextHint prioriza última OT cerrada', () => {
    component.lastClosedOt.set({ id: 'wo-x', correlative: 'OT-2026-009' });
    expect(component.initialMeterContextHint()).toContain('OT-2026-009');
  });
});
