import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';

import { WarehouseFormComponent } from './warehouse-form.component';

describe('WarehouseFormComponent', () => {
  let component: WarehouseFormComponent;
  let fixture: ComponentFixture<WarehouseFormComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [WarehouseFormComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(WarehouseFormComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
