import { ComponentFixture, TestBed } from '@angular/core/testing';

import { KitFormComponent } from './kit-form.component';

describe('KitFormComponent', () => {
  let component: KitFormComponent;
  let fixture: ComponentFixture<KitFormComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [KitFormComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(KitFormComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
