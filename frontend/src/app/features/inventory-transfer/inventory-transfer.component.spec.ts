import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { InventoryTransferComponent } from './inventory-transfer.component';
import { AuthService } from '../../core/services/auth/auth.service';
import { InventoryTransferService } from '../../core/services/inventory-transfer/inventory-transfer.service';
import { WarehousesService } from '../../core/services/warehouses/warehouses.service';
import { NotificationService } from '../../core/services/notification/notification.service';
import { InventoryItemsService } from '../../core/services/inventory-items/inventory-items.service';
import { ActivatedRoute } from '@angular/router';

describe('InventoryTransferComponent', () => {
  let fixture: ComponentFixture<InventoryTransferComponent>;
  let component: InventoryTransferComponent;
  let authService: any;
  let warehousesService: jasmine.SpyObj<WarehousesService>;

  const contractA = 'contract-a';
  const contractB = 'contract-b';
  const warehouseA = {
    id: 'wh-a',
    code: 'B-A',
    name: 'Central A',
    contractId: contractA,
    contract: { code: 'CTA', name: 'Contrato A' },
  };
  const warehouseB = {
    id: 'wh-b',
    code: 'B-B',
    name: 'Central B',
    contractId: contractB,
    contract: { code: 'CTB', name: 'Contrato B' },
    subcontract: { code: 'SB', name: 'Sub B' },
  };

  beforeEach(async () => {
    authService = {
      currentContractId: signal(contractA),
      currentUser: signal({
        id: 'user-1',
        role: 'USER',
        allowedContracts: [contractA, contractB],
        permissions: [
          'inventory:transfer:read',
          'inventory:transfer:create',
          'inventory:transfer:approve',
        ],
      }),
      userPermissions: signal([
        'inventory:transfer:read',
        'inventory:transfer:create',
        'inventory:transfer:approve',
      ]),
      hasPermission: jasmine.createSpy('hasPermission').and.callFake(
        (required: string | string[]) => {
          const values = Array.isArray(required) ? required : [required];
          return values.every((p) => authService.userPermissions().includes(p));
        },
      ),
      canViewInventoryCost: jasmine.createSpy('canViewInventoryCost').and.returnValue(false),
    };
    warehousesService = jasmine.createSpyObj<WarehousesService>(
      'WarehousesService',
      ['getWarehousesForTransfer'],
    );
    warehousesService.getWarehousesForTransfer.and.returnValue(
      of([warehouseA, warehouseB]),
    );

    await TestBed.configureTestingModule({
      imports: [InventoryTransferComponent],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: authService },
        {
          provide: InventoryTransferService,
          useValue: jasmine.createSpyObj('InventoryTransferService', {
            listTransfers: of({ data: [], total: 0, page: 1, pageSize: 25 }),
            getTransfer: of(null),
            createTransfer: of({}),
            confirmReception: of({}),
          }),
        },
        { provide: WarehousesService, useValue: warehousesService },
        {
          provide: NotificationService,
          useValue: jasmine.createSpyObj('NotificationService', [
            'success',
            'error',
            'info',
          ]),
        },
        {
          provide: InventoryItemsService,
          useValue: jasmine.createSpyObj('InventoryItemsService', {
            getCategoryFamilies: of([]),
            getCategoryChildren: of([]),
            getPickerPage: of({ data: [], total: 0, page: 1, pageSize: 20 }),
          }),
        },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { queryParamMap: convertToParamMap({}) },
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(InventoryTransferComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('carga bodegas W2W permitidas aunque el contrato activo sea uno solo', () => {
    expect(warehousesService.getWarehousesForTransfer).toHaveBeenCalled();
    expect(component.warehouses()).toEqual([warehouseA, warehouseB]);
  });

  it('permite seleccionar origen A y destino B para usuario con ambos contratos', () => {
    component.transferForm.patchValue({
      originWarehouseId: warehouseA.id,
      destinationWarehouseId: warehouseB.id,
    });
    fixture.detectChanges();

    expect(component.originWarehouseIdForPicker()).toBe(warehouseA.id);
    expect(component.transferForm.getRawValue().destinationWarehouseId).toBe(
      warehouseB.id,
    );
  });

  it('usuario con solo contrato A no recibe bodega B desde el scope W2W', () => {
    warehousesService.getWarehousesForTransfer.calls.reset();
    warehousesService.getWarehousesForTransfer.and.returnValue(of([warehouseA]));

    component.loadWarehouses();

    expect(component.warehouses()).toEqual([warehouseA]);
  });

  it('canConfirmReception valida por contrato destino y no por contrato activo', () => {
    expect(
      component.canConfirmReception({
        id: 'transfer-1',
        status: 'SHIPPED',
        createdAt: '2026-06-18T00:00:00.000Z',
        destinationWarehouse: {
          id: warehouseB.id,
          code: warehouseB.code,
          name: warehouseB.name,
          contractId: contractB,
        },
      }),
    ).toBeTrue();

    authService.currentUser.set({
      ...authService.currentUser(),
      allowedContracts: [contractA],
    });
    expect(
      component.canConfirmReception({
        id: 'transfer-2',
        status: 'SHIPPED',
        createdAt: '2026-06-18T00:00:00.000Z',
        destinationWarehouse: {
          id: warehouseB.id,
          code: warehouseB.code,
          name: warehouseB.name,
          contractId: contractB,
        },
      }),
    ).toBeFalse();
  });
});
