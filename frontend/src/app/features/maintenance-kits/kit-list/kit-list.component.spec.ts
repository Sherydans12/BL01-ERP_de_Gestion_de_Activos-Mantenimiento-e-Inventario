import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';

import { KitListComponent } from './kit-list.component';

describe('KitListComponent', () => {
  let component: KitListComponent;
  let fixture: ComponentFixture<KitListComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [KitListComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(KitListComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
