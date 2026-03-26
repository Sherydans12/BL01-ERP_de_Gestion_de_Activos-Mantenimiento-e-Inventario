import { ComponentFixture, TestBed } from '@angular/core/testing';

import { InventoryItemFormComponent } from './inventory-item-form.component';

describe('InventoryItemFormComponent', () => {
  let component: InventoryItemFormComponent;
  let fixture: ComponentFixture<InventoryItemFormComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [InventoryItemFormComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(InventoryItemFormComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
