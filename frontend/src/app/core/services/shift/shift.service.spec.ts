import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ShiftService } from './shift.service';
import { TenantService, Tenant } from '../tenant/tenant.service';

describe('ShiftService', () => {
  let service: ShiftService;
  const tenant = signal<Tenant | null>(null);

  beforeEach(() => {
    tenant.set(null);
    TestBed.configureTestingModule({
      providers: [
        ShiftService,
        {
          provide: TenantService,
          useValue: { currentTenant: tenant },
        },
      ],
    });
    service = TestBed.inject(ShiftService);
  });

  it('hasNightShift es false sin operationalConfig cargado', () => {
    expect(service.hasNightShift()).toBe(false);
  });

  it('coerceShift convierte NIGHT a DAY si no hay turno noche', () => {
    tenant.set({
      id: 't1',
      code: 'T',
      name: 'Test',
      operationalConfig: {
        hasNightShift: false,
        dayShiftStartTime: '08:00',
        nightShiftStartTime: '20:00',
      },
    });
    expect(service.coerceShift('NIGHT')).toBe('DAY');
  });

  it('selectableShifts solo incluye DAY sin turno noche', () => {
    tenant.set({
      id: 't1',
      code: 'T',
      name: 'Test',
      operationalConfig: {
        hasNightShift: false,
        dayShiftStartTime: '08:00',
        nightShiftStartTime: '20:00',
      },
    });
    expect(service.selectableShifts()).toEqual(['DAY']);
  });
});
