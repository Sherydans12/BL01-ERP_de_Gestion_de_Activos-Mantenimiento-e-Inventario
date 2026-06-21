import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';

import { ItemLedgerTableComponent } from './item-ledger-table.component';
import type { ItemLedgerRow } from '../../../core/services/inventory-items/inventory-items.service';

describe('ItemLedgerTableComponent', () => {
  let component: ItemLedgerTableComponent;
  let fixture: ComponentFixture<ItemLedgerTableComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ItemLedgerTableComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ItemLedgerTableComponent);
    component = fixture.componentInstance;
    component.itemId = 'item-1';
  });

  function ledgerRow(notes: string): ItemLedgerRow {
    return {
      id: 'tx-1',
      date: new Date('2026-06-20T12:00:00.000Z').toISOString(),
      type: 'ADJUST',
      quantity: -1,
      previousStock: 10,
      newStock: 9,
      notes,
      isPendingRegularization: false,
      referenceType: 'INVENTORY_ADJUSTMENT',
      warehouse: { id: 'wh-1', code: 'BOD-1', name: 'Bodega 1' },
      user: { id: 'user-1', name: 'Usuario' },
      reference: {
        kind: 'INVENTORY_ADJUSTMENT',
        label: 'Ajuste de inventario',
      },
    };
  }

  it('muestra motivo normalizado en kardex global para CONTEO antiguo', () => {
    expect(
      component.movementTitle(
        ledgerRow('Ajuste [Error de conteo]: diferencia de conteo'),
      ),
    ).toBe('Ajuste por inventario (conteo / hallazgo)');
  });

  it('muestra Entrega de EPP en kardex global', () => {
    expect(
      component.movementTitle(
        ledgerRow('Ajuste [Entrega de EPP]: entrega a operador'),
      ),
    ).toBe('Entrega de EPP');
  });
});

