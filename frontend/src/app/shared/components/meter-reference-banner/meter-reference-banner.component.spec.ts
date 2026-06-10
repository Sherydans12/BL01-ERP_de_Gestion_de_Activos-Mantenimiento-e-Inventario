import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MeterReferenceBannerComponent } from './meter-reference-banner.component';
import { MeterType } from '../../../core/models/types';

describe('MeterReferenceBannerComponent', () => {
  let fixture: ComponentFixture<MeterReferenceBannerComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MeterReferenceBannerComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(MeterReferenceBannerComponent);
  });

  it('muestra mensaje de lectura inicial sin lastLog en snapshot', () => {
    fixture.componentRef.setInput('snapshot', {
      equipmentId: 'eq-1',
      currentMeter: 500,
      meterType: MeterType.HOURS,
      internalId: 'EQ-1',
      lastLog: null,
    });
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('Sin registros previos');
    expect(el.textContent).toContain('500');
  });

  it('muestra última lectura con fuente desde boardRow', () => {
    fixture.componentRef.setInput('boardRow', {
      id: 'eq-2',
      internalId: 'EQ-2',
      displayName: 'Test',
      type: 'Pala',
      currentMeter: 1200,
      meterType: MeterType.HOURS,
      lastReadingAt: '2026-06-01T12:00:00.000Z',
      lastReadingSource: 'AVAILABILITY_REPORT',
      contractCode: null,
      subcontractCode: null,
    });
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('Última lectura');
    expect(el.textContent).toContain('Disponibilidad');
  });
});
