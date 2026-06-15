import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of } from 'rxjs';

import { OperationsKpiDashboardComponent } from './dashboard.component';
import {
  AnalyticsService,
  KpiDashboardResponse,
} from '../../../core/services/analytics/analytics.service';
import { ContractsService } from '../../../core/services/contracts/contracts.service';
import { NotificationService } from '../../../core/services/notification/notification.service';
import { AuthService } from '../../../core/services/auth/auth.service';

const MOCK_KPI: KpiDashboardResponse = {
  period: { from: '2026-06-01', to: '2026-06-30' },
  contractId: null,
  kpis: {
    physicalAvailabilityPct: 80,
    mttrHours: 3,
    mtbfHours: 48,
  },
  physicalAvailability: {
    operationalShiftHours: 96,
    totalShiftHours: 120,
    reportedShifts: 10,
    operationalShifts: 8,
  },
  mttr: { correctiveOtCount: 2, totalRepairHours: 6 },
  mtbf: { criticalFaultCount: 2, intervalCount: 1 },
  lubeTrendMonthly: [
    {
      month: '2026-06',
      totalLiters: 150,
      machineHours: 500,
      litersPerMachineHour: 0.3,
    },
  ],
  meta: { cached: false, generatedAt: '2026-06-04T12:00:00.000Z' },
};

const analyticsSpy = jasmine.createSpyObj<AnalyticsService>('AnalyticsService', {
  getKpiDashboard: of(MOCK_KPI),
});

const contractsSpy = jasmine.createSpyObj<ContractsService>('ContractsService', {
  findAll: of([]),
});

const notifySpy = jasmine.createSpyObj<NotificationService>('NotificationService', [
  'error',
]);

const authSpy = jasmine.createSpyObj<AuthService>('AuthService', [], {
  currentUser: signal({
    id: 'usr-1',
    email: 'a@test.cl',
    name: 'Admin',
    role: 'ADMIN' as const,
    allowedContracts: ['ALL'],
  }),
});

describe('OperationsKpiDashboardComponent', () => {
  let fixture: ComponentFixture<OperationsKpiDashboardComponent>;
  let component: OperationsKpiDashboardComponent;

  beforeEach(async () => {
    analyticsSpy.getKpiDashboard.calls.reset();

    await TestBed.configureTestingModule({
      imports: [OperationsKpiDashboardComponent],
      providers: [
        { provide: AnalyticsService, useValue: analyticsSpy },
        { provide: ContractsService, useValue: contractsSpy },
        { provide: NotificationService, useValue: notifySpy },
        { provide: AuthService, useValue: authSpy },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(OperationsKpiDashboardComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('debería crearse y cargar KPIs al iniciar', () => {
    expect(component).toBeTruthy();
    expect(analyticsSpy.getKpiDashboard).toHaveBeenCalled();
  });

  it('muestra los KPIs del mock en pantalla', () => {
    component.isLoading.set(false);
    component.dashboard.set(MOCK_KPI);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('80.0%');
    expect(el.textContent).toContain('3.0 h');
    expect(el.textContent).toContain('48.0 h');
  });

  it('recarga al cambiar el rango de fechas', () => {
    analyticsSpy.getKpiDashboard.calls.reset();
    component.onDateToChange('2026-06-16');
    fixture.detectChanges();
    expect(analyticsSpy.getKpiDashboard).toHaveBeenCalled();
  });
});
