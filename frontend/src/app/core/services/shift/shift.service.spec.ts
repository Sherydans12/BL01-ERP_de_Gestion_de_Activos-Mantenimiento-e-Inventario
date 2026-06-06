import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ShiftService } from './shift.service';
import { TenantService, Tenant } from '../tenant/tenant.service';

function tenantWithNightShift(hasNightShift: boolean): Tenant {
  return {
    id: 't1',
    code: 'T',
    name: 'Test',
    operationalConfig: {
      hasNightShift,
      dayShiftStartTime: '08:00',
      nightShiftStartTime: '20:00',
    },
  };
}

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
    expect(service.operationalConfigLoaded()).toBe(false);
  });

  it('coerceShift convierte NIGHT a DAY si no hay turno noche', () => {
    tenant.set(tenantWithNightShift(false));
    expect(service.coerceShift('NIGHT')).toBe('DAY');
  });

  it('selectableShifts solo incluye DAY sin turno noche', () => {
    tenant.set(tenantWithNightShift(false));
    expect(service.selectableShifts()).toEqual(['DAY']);
  });

  it('con turno noche habilitado conserva coerceShift NIGHT', () => {
    tenant.set(tenantWithNightShift(true));
    expect(service.coerceShift('NIGHT')).toBe('NIGHT');
    expect(service.operationalConfigLoaded()).toBe(true);
  });

  it('sin turno noche: currentShift nunca devuelve NIGHT', () => {
    tenant.set(tenantWithNightShift(false));
    expect(service.currentShift()).toBe('DAY');
  });

  it('alignShiftAfterConfigLoad respeta ?shift= fijo en URL', () => {
    tenant.set(tenantWithNightShift(false));
    expect(service.alignShiftAfterConfigLoad('NIGHT', true)).toBe('DAY');
    tenant.set(tenantWithNightShift(true));
    expect(service.alignShiftAfterConfigLoad('DAY', true)).toBe('DAY');
  });

  it('alignShiftAfterConfigLoad sin URL fija delega en currentShift', () => {
    tenant.set(tenantWithNightShift(true));
    expect(service.alignShiftAfterConfigLoad('DAY', false)).toBe(
      service.currentShift(),
    );
  });
});
