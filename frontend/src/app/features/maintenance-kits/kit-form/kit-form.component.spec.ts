import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';

import { KitFormComponent } from './kit-form.component';

describe('KitFormComponent', () => {
  let component: KitFormComponent;
  let fixture: ComponentFixture<KitFormComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [KitFormComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(KitFormComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
