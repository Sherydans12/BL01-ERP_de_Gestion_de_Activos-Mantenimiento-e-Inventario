import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';

import { InventoryItemsService } from '../../../core/services/inventory-items/inventory-items.service';
import { NotificationService } from '../../../core/services/notification/notification.service';
import { InventoryMasterImportComponent } from './inventory-master-import.component';

describe('InventoryMasterImportComponent', () => {
  let fixture: ComponentFixture<InventoryMasterImportComponent>;
  let component: InventoryMasterImportComponent;
  let inventoryService: jasmine.SpyObj<InventoryItemsService>;

  const preview = {
    domain: 'inventory' as const,
    version: '1',
    summary: {
      rows: 1,
      creates: 0,
      updates: 1,
      unchanged: 0,
      errors: 0,
      deleteCandidates: 0,
    },
    requirements: [],
    previewRows: [
      {
        rowNumber: 6,
        action: 'UPDATE',
        itemId: 'item-1',
        inventoryCode: 'IN0001',
        partNumber: 'PN-001',
        warehouseCode: 'B01',
        label: 'IN0001 · PN-001',
        errors: [],
        warnings: [],
        changes: [{ field: 'stock.quantity', before: 5, after: 8 }],
      },
    ],
    deleteCandidates: [],
    configuration: {
      requiredBeforeCommit: [],
      options: {
        allowStockAdjustments: true,
        autoCreateBins: true,
      },
    },
  };

  beforeEach(async () => {
    inventoryService = jasmine.createSpyObj<InventoryItemsService>(
      'InventoryItemsService',
      ['validateInventoryMasterImport', 'commitInventoryMasterImport'],
    );
    inventoryService.validateInventoryMasterImport.and.returnValue(of(preview));
    inventoryService.commitInventoryMasterImport.and.returnValue(
      of({
        created: 0,
        updated: 1,
        unchanged: 0,
        stockAdjusted: 1,
        deleted: 0,
        skippedDeleteCandidates: 0,
        warnings: [],
      }),
    );

    await TestBed.configureTestingModule({
      imports: [InventoryMasterImportComponent],
      providers: [
        provideRouter([]),
        { provide: InventoryItemsService, useValue: inventoryService },
        {
          provide: NotificationService,
          useValue: jasmine.createSpyObj<NotificationService>(
            'NotificationService',
            ['success', 'error', 'info'],
          ),
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(InventoryMasterImportComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('no expone opciones de CRUD de articulos por Excel', () => {
    component.preview.set(preview);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('El Excel no crea, edita ni elimina artículos');
    expect(text).not.toContain('Permitir altas');
    expect(text).not.toContain('Permitir actualizaciones');
    expect(text).not.toContain('Eliminar artículos');
    expect(text).not.toContain('Crear proveedores');
  });

  it('bloquea confirmacion si la vista previa tiene errores', () => {
    component.preview.set({
      ...preview,
      summary: { ...preview.summary, errors: 1 },
    });

    expect(component.canCommit()).toBeFalse();
  });

  it('envia solo opciones operativas al confirmar', () => {
    const file = new File(['x'], 'stock.xlsx');
    component.file.set(file);
    component.preview.set(preview);

    component.commit();

    expect(inventoryService.commitInventoryMasterImport).toHaveBeenCalledOnceWith(
      file,
      {
        allowStockAdjustments: true,
        autoCreateBins: true,
      },
    );
  });

  it('mantiene la vista previa si el commit falla', () => {
    inventoryService.commitInventoryMasterImport.and.returnValue(
      throwError(() => ({ error: { message: 'Error controlado' } })),
    );
    component.file.set(new File(['x'], 'stock.xlsx'));
    component.preview.set(preview);

    component.commit();

    expect(component.state()).toBe('preview');
  });
});
