import { ComponentFixture, TestBed } from '@angular/core/testing';

import { KitListComponent } from './kit-list.component';

describe('KitListComponent', () => {
  let component: KitListComponent;
  let fixture: ComponentFixture<KitListComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [KitListComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(KitListComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
