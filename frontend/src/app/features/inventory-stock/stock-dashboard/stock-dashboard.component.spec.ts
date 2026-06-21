import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';

import { StockDashboardComponent } from './stock-dashboard.component';

describe('StockDashboardComponent', () => {
  let component: StockDashboardComponent;
  let fixture: ComponentFixture<StockDashboardComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StockDashboardComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(StockDashboardComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('renders stock rows even when item relation is missing', () => {
    component.selectedWarehouseId.set('warehouse-1');
    component.totalItems.set(1);
    component.stockItems.set([
      {
        id: 'stock-1',
        itemId: 'item-orphan',
        item: undefined,
        quantity: 7,
        minStock: 0,
        maxStock: 0,
        unitCost: null,
        location: null,
        reservedQuantity: 0,
        availableQuantity: 7,
        fieldDispatchOutstandingQty: 0,
      } as any,
    ]);

    expect(() => fixture.detectChanges()).not.toThrow();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('SIN-PN');
    expect(text).toContain('Artículo sin ficha');
    expect(text).toContain('7');
  });

  it('muestra motivo normalizado en kardex por bodega para ajustes de conteo antiguos', () => {
    const title = component.kardexMovementTitle({
      type: 'ADJUST',
      referenceType: 'INVENTORY_ADJUSTMENT',
      notes: 'Ajuste [Error de conteo]: diferencia de inventario',
    });

    expect(title).toBe('Ajuste por inventario (conteo / hallazgo)');
  });

  it('muestra Entrega de EPP en kardex por bodega', () => {
    const title = component.kardexMovementTitle({
      type: 'ADJUST',
      referenceType: 'INVENTORY_ADJUSTMENT',
      notes: 'Ajuste [Entrega de EPP]: entrega a operador',
    });

    expect(title).toBe('Entrega de EPP');
  });
});
