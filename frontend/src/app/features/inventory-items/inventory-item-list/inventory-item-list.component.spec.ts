import { ComponentFixture, TestBed } from '@angular/core/testing';

import { InventoryItemListComponent } from './inventory-item-list.component';

describe('InventoryItemListComponent', () => {
  let component: InventoryItemListComponent;
  let fixture: ComponentFixture<InventoryItemListComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [InventoryItemListComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(InventoryItemListComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
