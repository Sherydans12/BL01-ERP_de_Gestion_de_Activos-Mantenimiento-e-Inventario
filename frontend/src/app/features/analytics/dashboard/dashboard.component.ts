import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Chart, registerables } from 'chart.js';
import { finalize } from 'rxjs/operators';
import {
  AnalyticsService,
  KpiDashboardResponse,
} from '../../../core/services/analytics/analytics.service';
import { ContractsService } from '../../../core/services/contracts/contracts.service';
import { NotificationService } from '../../../core/services/notification/notification.service';
import { AuthService } from '../../../core/services/auth/auth.service';
import { Contract } from '../../../core/models/types';
import { O } from '../../../core/constants/operations-permissions';

Chart.register(...registerables);

function toInputDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function defaultPeriodFrom(): Date {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), 1);
}

@Component({
  selector: 'app-operations-kpi-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './dashboard.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OperationsKpiDashboardComponent implements OnInit, OnDestroy {
  protected readonly O = O;

  private analyticsApi = inject(AnalyticsService);
  private contractsService = inject(ContractsService);
  private notify = inject(NotificationService);
  private auth = inject(AuthService);

  lubeChartCanvas = viewChild<ElementRef<HTMLCanvasElement>>('lubeChart');

  contracts = signal<Contract[]>([]);
  dashboard = signal<KpiDashboardResponse | null>(null);
  isLoading = signal(false);

  dateFrom = signal(toInputDate(defaultPeriodFrom()));
  dateTo = signal(toInputDate(new Date()));
  contractId = signal('');

  totalLubeLiters = computed(() =>
    (this.dashboard()?.lubeTrendMonthly ?? []).reduce(
      (sum, p) => sum + p.totalLiters,
      0,
    ),
  );

  private lubeChart: Chart | null = null;
  private loadGeneration = 0;

  constructor() {
    effect(
      () => {
        const from = this.dateFrom();
        const to = this.dateTo();
        const contract = this.contractId();
        if (!from || !to) return;
        this.fetchDashboard(from, to, contract || undefined);
      },
      { allowSignalWrites: true },
    );

    effect(() => {
      const data = this.dashboard();
      if (!data) return;
      queueMicrotask(() => this.renderLubeChart(data));
    });
  }

  ngOnInit(): void {
    this.contractsService.findAll().subscribe({
      next: (list) =>
        this.contracts.set(list.filter((c) => c.isActive !== false)),
      error: () => { /* no bloquea KPIs */ },
    });
  }

  ngOnDestroy(): void {
    this.lubeChart?.destroy();
    this.lubeChart = null;
  }

  onDateFromChange(v: string): void {
    this.dateFrom.set(v);
  }

  onDateToChange(v: string): void {
    this.dateTo.set(v);
  }

  onContractChange(v: string): void {
    this.contractId.set(v);
  }

  formatPct(v: number | null): string {
    return v == null ? '—' : `${v.toFixed(1)}%`;
  }

  formatHours(v: number | null): string {
    return v == null ? '—' : `${v.toFixed(1)} h`;
  }

  contractOptions = () => {
    const all = this.contracts();
    const role = this.auth.currentUser()?.role;
    const allowed = this.auth.currentUser()?.allowedContracts ?? [];
    if (role === 'ADMIN' || role === 'SUPER_ADMIN' || allowed.includes('ALL')) {
      return all;
    }
    return all.filter((c) => allowed.includes(c.id));
  };

  private fetchDashboard(from: string, to: string, contractId?: string): void {
    const gen = ++this.loadGeneration;
    this.isLoading.set(true);
    this.analyticsApi
      .getKpiDashboard({ from, to, contractId })
      .pipe(
        finalize(() => {
          if (gen === this.loadGeneration) {
            this.isLoading.set(false);
          }
        }),
      )
      .subscribe({
        next: (res) => {
          if (gen === this.loadGeneration) {
            this.dashboard.set(res);
          }
        },
        error: () => {
          this.notify.error('No se pudieron cargar los KPIs operativos.');
        },
      });
  }

  private renderLubeChart(data: KpiDashboardResponse): void {
    const canvas = this.lubeChartCanvas()?.nativeElement;
    if (!canvas) return;

    const points = data.lubeTrendMonthly;
    const labels = points.map((p) => p.month);
    const liters = points.map((p) => p.totalLiters);
    const ratio = points.map((p) => p.litersPerMachineHour ?? 0);

    this.lubeChart?.destroy();
    this.lubeChart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Litros despachados',
            data: liters,
            backgroundColor: 'rgba(0, 229, 255, 0.35)',
            borderColor: 'rgba(0, 229, 255, 0.9)',
            borderWidth: 1,
            yAxisID: 'y',
          },
          {
            type: 'line',
            label: 'L/hora máquina',
            data: ratio,
            borderColor: 'rgba(250, 204, 21, 0.9)',
            backgroundColor: 'transparent',
            tension: 0.25,
            yAxisID: 'y1',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 200 },
        plugins: { legend: { labels: { color: '#94a3b8' } } },
        scales: {
          x: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(42,52,65,0.5)' } },
          y: {
            position: 'left',
            ticks: { color: '#94a3b8' },
            grid: { color: 'rgba(42,52,65,0.5)' },
            title: { display: true, text: 'Litros', color: '#94a3b8' },
          },
          y1: {
            position: 'right',
            ticks: { color: '#94a3b8' },
            grid: { drawOnChartArea: false },
            title: { display: true, text: 'L / h máq.', color: '#94a3b8' },
          },
        },
      },
    });
  }
}
