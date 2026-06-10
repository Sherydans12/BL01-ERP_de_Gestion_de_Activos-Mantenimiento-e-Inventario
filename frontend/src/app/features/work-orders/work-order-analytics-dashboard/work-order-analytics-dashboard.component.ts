import {
  Component,
  HostListener,
  inject,
  OnDestroy,
  OnInit,
  signal,
  computed,
  ElementRef,
  viewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { Chart, registerables } from 'chart.js';
import { forkJoin } from 'rxjs';
import { finalize } from 'rxjs/operators';
import {
  WorkOrderAnalyticsService,
  WorkOrderAnalyticsDashboard,
  ProjectedServiceRow,
} from '../../../core/services/work-order-analytics/work-order-analytics.service';
import { ContractsService } from '../../../core/services/contracts/contracts.service';
import { NotificationService } from '../../../core/services/notification/notification.service';
import { Contract } from '../../../core/models/types';
import { AuthService } from '../../../core/services/auth/auth.service';
import { O } from '../../../core/constants/operations-permissions';
import { equipmentDisplayLabel } from '../../../core/utils/equipment-display-label';

Chart.register(...registerables);

function toInputDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Mes en curso: día 1 local → hoy (evita rango vacío al primer ingreso). */
function defaultPeriodFrom(): Date {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), 1);
}

@Component({
  selector: 'app-work-order-analytics-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './work-order-analytics-dashboard.component.html',
})
export class WorkOrderAnalyticsDashboardComponent implements OnInit, OnDestroy {
  private analyticsApi = inject(WorkOrderAnalyticsService);
  private contractsService = inject(ContractsService);
  private notify = inject(NotificationService);
  private auth = inject(AuthService);

  contracts = signal<Contract[]>([]);
  dashboard = signal<WorkOrderAnalyticsDashboard | null>(null);
  projected = signal<ProjectedServiceRow[]>([]);
  isLoading = signal(false);

  contractId = signal('');
  dateFrom = signal('');
  dateTo = signal('');

  pdfYear = signal(new Date().getFullYear());
  pdfMonth = signal(new Date().getMonth() + 1);
  isExportingPdf = signal(false);

  metricsGuideOpen = signal(false);

  /** Panel de ayuda ⓘ abierto; `null` = cerrado. */
  openInfoPanel = signal<string | null>(null);

  toggleInfoPanel(key: string, event: Event): void {
    event.stopPropagation();
    this.openInfoPanel.update((k) => (k === key ? null : key));
  }

  closeInfoPanel(): void {
    this.openInfoPanel.set(null);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(ev: MouseEvent): void {
    if (!this.openInfoPanel()) return;
    const t = ev.target as HTMLElement | null;
    if (t?.closest('[data-analytics-help]')) return;
    this.closeInfoPanel();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.openInfoPanel()) this.closeInfoPanel();
  }

  readonly paFormulaTooltip =
    'Disponibilidad física de la flota en el período: (horas totales del período − horas de detención con impacto en disponibilidad) ÷ horas totales del período. Las horas de detención se recortan al rango de fechas seleccionado.';

  /** Textos breves para paneles ⓘ en KPIs; la guía ampliada sigue en el modal del footer. */
  readonly mttrTooltip =
    'MTTR (Mean Time To Repair): tiempo medio de reparación. Aquí es el promedio de horas de detención de las OT correctivas cerradas en el período (inicio→fin de detención, recortado al rango de fechas).';

  readonly mtbfTooltip =
    'MTBF (Mean Time Between Failures): tiempo medio entre fallas. Aquí es el promedio de horas entre inicios de detención de OT no programadas (correctiva o reactiva), calculado entre eventos consecutivos por equipo y luego agregado.';

  readonly downtimeTooltip =
    'Suma de horas de detención donde la OT indicó impacto en disponibilidad (SI), recortadas al período. No es “horas totales de taller”; solo lo que cuenta contra PA.';

  readonly availChartTooltip =
    'Por equipo: disponibilidad estimada en el período (menor valor = peor desempeño). Usa detenciones con impacto en disponibilidad.';

  readonly paretoChartTooltip =
    'Cuenta OT cerradas que marcaron intervención en cada sistema (eléctrico, mecánico, etc.) según el checklist de la OT.';

  readonly programmedChartTooltip =
    'Cuántas OT cerradas son programadas vs no programadas u otras, según la categoría derivada al cerrar.';

  readonly pmSourceColumnTooltip =
    'De dónde sale el intervalo entre servicios: override manual en flota, frecuencia del maestro o regla heurística por tipo de equipo.';

  selectedContractDisplay = computed(() => {
    const id = this.contractId().trim();
    if (!id) return 'Todos los contratos';
    const c = this.contracts().find((x) => x.id === id);
    return c ? `${c.code} — ${c.name}` : id;
  });

  canExportMonthlyPdf = computed(() => {
    if (!this.auth.hasPermission(O.WORK_ORDER_READ)) {
      return false;
    }
    return !this.isLoading() && !this.isExportingPdf();
  });

  projectedSorted = computed(() => {
    const rows = [...this.projected()];
    rows.sort((a, b) => a.remainingUnits - b.remainingUnits);
    return rows;
  });

  availCanvas = viewChild<ElementRef<HTMLCanvasElement>>('availCanvas');
  paretoCanvas = viewChild<ElementRef<HTMLCanvasElement>>('paretoCanvas');
  programmedCanvas =
    viewChild<ElementRef<HTMLCanvasElement>>('programmedCanvas');

  private chartAvail: Chart | null = null;
  private chartPareto: Chart | null = null;
  private chartProgrammed: Chart | null = null;

  ngOnInit(): void {
    const to = new Date();
    const from = defaultPeriodFrom();
    this.dateFrom.set(toInputDate(from));
    this.dateTo.set(toInputDate(to));

    this.contractsService.findAll().subscribe({
      next: (c) => this.contracts.set(c),
      error: () => this.contracts.set([]),
    });
    this.load();
  }

  ngOnDestroy(): void {
    this.destroyCharts();
  }

  load(): void {
    this.isLoading.set(true);
    const cid = this.contractId().trim();
    const fromIso = new Date(this.dateFrom()).toISOString();
    const toIso = new Date(this.dateTo() + 'T23:59:59.999').toISOString();

    forkJoin({
      dashboard: this.analyticsApi.getDashboard({
        from: fromIso,
        to: toIso,
        ...(cid ? { contractId: cid } : {}),
      }),
      projected: this.analyticsApi.getProjectedServices({
        limit: 200,
        ...(cid ? { contractId: cid } : {}),
      }),
    })
      .pipe(finalize(() => this.isLoading.set(false)))
      .subscribe({
        next: ({ dashboard, projected }) => {
          this.dashboard.set(dashboard);
          this.projected.set(projected);
          setTimeout(() => this.renderCharts(dashboard), 0);
        },
        error: () => {
          this.notify.error('No se pudo cargar la analítica de OT');
          this.dashboard.set(null);
          this.projected.set([]);
        },
      });
  }

  exportMonthlyPdf(): void {
    if (!this.canExportMonthlyPdf()) return;
    this.isExportingPdf.set(true);
    const cid = this.contractId().trim();
    this.analyticsApi
      .downloadMonthlyManagementPdf({
        year: this.pdfYear(),
        month: this.pdfMonth(),
        ...(cid ? { contractId: cid } : {}),
      })
      .pipe(finalize(() => this.isExportingPdf.set(false)))
      .subscribe({
        next: (res) => {
          const blob = res.body;
          if (!blob) {
            this.notify.error('Respuesta PDF vacía');
            return;
          }
          let filename = `Resumen_Gestion_Mantenimiento_${this.pdfYear()}-${String(this.pdfMonth()).padStart(2, '0')}.pdf`;
          const cd = res.headers.get('Content-Disposition');
          const m = cd?.match(/filename="?([^";]+)"?/i);
          if (m?.[1]) filename = m[1];
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = filename;
          a.click();
          URL.revokeObjectURL(url);
          this.notify.success('PDF descargado');
        },
        error: () =>
          this.notify.error('No se pudo generar el PDF mensual'),
      });
  }

  private destroyCharts(): void {
    this.chartAvail?.destroy();
    this.chartPareto?.destroy();
    this.chartProgrammed?.destroy();
    this.chartAvail =
      this.chartPareto =
      this.chartProgrammed =
        null;
  }

  private renderCharts(d: WorkOrderAnalyticsDashboard): void {
    this.destroyCharts();

    const availEl = this.availCanvas()?.nativeElement;
    const paretoEl = this.paretoCanvas()?.nativeElement;
    const progEl = this.programmedCanvas()?.nativeElement;
    if (!availEl || !paretoEl || !progEl) return;

    const availRows = [...d.availabilityByEquipment]
      .filter((r) => r.availabilityPct != null)
      .sort((a, b) => (a.availabilityPct ?? 0) - (b.availabilityPct ?? 0))
      .slice(0, 24);

    if (availRows.length) {
      this.chartAvail = new Chart(availEl, {
        type: 'bar',
        data: {
          labels: availRows.map((r) =>
            equipmentDisplayLabel({
              internalId: r.internalId,
              plate: r.plate,
              brand: r.brand,
              model: r.model,
            }),
          ),
          datasets: [
            {
              label: 'Disponibilidad física estimada (%)',
              data: availRows.map((r) =>
                Math.round((r.availabilityPct ?? 0) * 10) / 10,
              ),
              backgroundColor: 'rgba(34, 211, 238, 0.55)',
            },
          ],
        },
        options: {
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            x: {
              min: 0,
              max: 100,
              ticks: { color: '#94a3b8' },
            },
            y: { ticks: { color: '#94a3b8', font: { size: 10 } } },
          },
          plugins: {
            legend: { labels: { color: '#94a3b8' } },
          },
        },
      });
    }

    const pareto = d.paretoSystems.filter((p) => p.otCount > 0);
    if (pareto.length) {
      this.chartPareto = new Chart(paretoEl, {
        type: 'bar',
        data: {
          labels: pareto.map((p) => p.label),
          datasets: [
            {
              label: 'OT con intervención',
              data: pareto.map((p) => p.otCount),
              backgroundColor: 'rgba(244, 114, 182, 0.55)',
            },
          ],
        },
        options: {
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            x: { ticks: { color: '#94a3b8', precision: 0 }, beginAtZero: true },
            y: { ticks: { color: '#94a3b8' } },
          },
          plugins: {
            legend: { labels: { color: '#94a3b8' } },
          },
        },
      });
    }

    const ps = d.programmedSplit;
    const progTotal = ps.programmed + ps.notProgrammed + ps.unknown;
    if (progTotal > 0) {
      this.chartProgrammed = new Chart(progEl, {
        type: 'doughnut',
        data: {
          labels: ['Programada', 'No programada', 'Sin clasificar'],
          datasets: [
            {
              data: [ps.programmed, ps.notProgrammed, ps.unknown],
              backgroundColor: [
                'rgba(34, 211, 238, 0.65)',
                'rgba(251, 113, 133, 0.65)',
                'rgba(148, 163, 184, 0.55)',
              ],
              borderWidth: 0,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: 'bottom', labels: { color: '#94a3b8' } },
          },
        },
      });
    }
  }

  projectedEquipmentLabel(row: ProjectedServiceRow): string {
    return equipmentDisplayLabel({
      internalId: row.internalId,
      plate: row.plate,
      brand: row.brand,
      model: row.model,
    });
  }
}
