import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SiteMasterComponent } from './site-master.component';

describe('SiteMasterComponent', () => {
  let component: SiteMasterComponent;
  let fixture: ComponentFixture<SiteMasterComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SiteMasterComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(SiteMasterComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
