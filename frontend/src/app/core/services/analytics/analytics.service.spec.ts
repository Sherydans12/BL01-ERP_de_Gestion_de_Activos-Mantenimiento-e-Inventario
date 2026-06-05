import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';

import { AnalyticsService } from './analytics.service';

describe('AnalyticsService', () => {
  let service: AnalyticsService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(AnalyticsService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('GET kpi-dashboard con from/to', () => {
    service.getKpiDashboard({ from: '2026-06-01', to: '2026-06-30' }).subscribe();
    const req = httpMock.expectOne(
      (r) =>
        r.url.includes('/analytics/kpi-dashboard') &&
        r.params.get('from') === '2026-06-01' &&
        r.params.get('to') === '2026-06-30',
    );
    expect(req.request.method).toBe('GET');
    req.flush({
      period: { from: '2026-06-01', to: '2026-06-30' },
      contractId: null,
      kpis: { physicalAvailabilityPct: 80, mttrHours: 3, mtbfHours: 48 },
      physicalAvailability: {
        operationalShiftHours: 96,
        totalShiftHours: 120,
        reportedShifts: 10,
        operationalShifts: 8,
      },
      mttr: { correctiveOtCount: 2, totalRepairHours: 6 },
      mtbf: { criticalFaultCount: 2, intervalCount: 1 },
      lubeTrendMonthly: [],
      meta: { cached: false, generatedAt: new Date().toISOString() },
    });
  });
});
