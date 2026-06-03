import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';

import { InventoryItemListComponent } from './inventory-item-list.component';

describe('InventoryItemListComponent', () => {
  let component: InventoryItemListComponent;
  let fixture: ComponentFixture<InventoryItemListComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [InventoryItemListComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(InventoryItemListComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
