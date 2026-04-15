import {
  Component,
  inject,
  OnInit,
  OnDestroy,
  signal,
  computed,
  ElementRef,
  viewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { Chart, registerables } from 'chart.js';
import {
  PurchasesService,
  PurchasesAnalyticsDashboard,
  PurchaseOrder,
  PurchaseInvoice,
} from '../../../core/services/purchases/purchases.service';
import { ContractsService } from '../../../core/services/contracts/contracts.service';
import { NotificationService } from '../../../core/services/notification/notification.service';
import { ClpCurrencyPipe } from '../../../shared/pipes/clp-currency.pipe';
import { Contract } from '../../../core/models/types';
import { PurchasesPushNoticeComponent } from '../../../shared/components/purchases-push-notice/purchases-push-notice.component';
import { PurchasesConceptInfoComponent } from '../../../shared/components/purchases-concept-info/purchases-concept-info.component';
import { HttpErrorResponse } from '@angular/common/http';
import { finalize } from 'rxjs/operators';
import { forkJoin } from 'rxjs';
import { EntityLinkComponent } from '../../../shared/components/entity-link/entity-link.component';
import { AuthService } from '../../../core/services/auth/auth.service';
import {
  InventoryAnalyticsService,
  SavingsVariationResponse,
  VendorPerformanceRow,
} from '../../../core/services/inventory-analytics/inventory-analytics.service';

Chart.register(...registerables);

function toInputDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

@Component({
  selector: 'app-purchases-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    ClpCurrencyPipe,
    PurchasesPushNoticeComponent,
    PurchasesConceptInfoComponent,
    EntityLinkComponent,
  ],
  templateUrl: './purchases-dashboard.component.html',
})
export class PurchasesDashboardComponent implements OnInit, OnDestroy {
  private purchasesService = inject(PurchasesService);
  private contractsService = inject(ContractsService);
  private notify = inject(NotificationService);
  private auth = inject(AuthService);
  private inventoryAnalytics = inject(InventoryAnalyticsService);

  contracts = signal<Contract[]>([]);
  dashboard = signal<PurchasesAnalyticsDashboard | null>(null);
  isLoading = signal(true);

  contractId = signal('');
  dateFrom = signal('');
  dateTo = signal('');

  /** Texto del contrato aplicado al dashboard (filtro). */
  selectedContractDisplay = computed(() => {
    const id = this.contractId().trim();
    if (!id) {
      return 'Todos los contratos';
    }
    const c = this.contracts().find((x) => x.id === id);
    return c ? `${c.code} — ${c.name}` : id;
  });

  hasPieChart = computed(() => {
    const d = this.dashboard();
    if (!d) return false;
    const imp = d.imputationSpend;
    return imp.general + imp.equipment + imp.workOrder > 0;
  });

  hasBarChart = computed(() => (this.dashboard()?.topVendors.length ?? 0) > 0);

  hasLineChart = computed(() => (this.dashboard()?.monthlySpend.length ?? 0) > 0);

  /** Los filtros en pantalla coinciden con el último `load()` (mismos query params que el backend devolvió en `filters`). */
  currentQueryMatchesDashboard = computed(() => {
    const d = this.dashboard();
    if (!d) return false;
    const cid = this.contractId().trim();
    const loadedCid = (d.filters.contractId ?? '').trim();
    if (cid !== loadedCid) return false;
    const fromQ = new Date(this.dateFrom()).toISOString();
    const toQ = new Date(this.dateTo() + 'T23:59:59.999').toISOString();
    return d.filters.from === fromQ && d.filters.to === toQ;
  });

  /** Exportar PDF solo con datos coherentes y gasto aprobado > 0 en el rango cargado. */
  canExportExecutiveReport = computed(() => {
    if (this.isLoading() || !this.dashboard()) return false;
    const d = this.dashboard()!;
    if (!this.currentQueryMatchesDashboard()) return false;
    return d.kpis.totalApprovedSpend > 0;
  });

  exportPdfHint = computed(() => {
    if (this.isExportingPdf()) return 'Generando PDF…';
    if (this.isLoading() || !this.dashboard()) {
      return 'Espera a que carguen los datos del tablero';
    }
    if (!this.currentQueryMatchesDashboard()) {
      return 'Aplica los filtros para alinear los datos mostrados antes de exportar';
    }
    if ((this.dashboard()?.kpis.totalApprovedSpend ?? 0) <= 0) {
      return 'No hay gasto aprobado en el período seleccionado; no hay datos que exportar';
    }
    return '';
  });

  isExportingPdf = signal(false);

  /** Widgets inferiores: últimas OC y facturas PENDING (mismo filtro de contrato cuando aplica). */
  recentPurchaseOrders = signal<PurchaseOrder[]>([]);
  pendingReconcileInvoices = signal<PurchaseInvoice[]>([]);
  vendorsPerformance = signal<VendorPerformanceRow[]>([]);
  savingsVariation = signal<SavingsVariationResponse | null>(null);

  readonly conceptThreeWay =
    'Validación automática entre lo pactado (OC), lo recibido (Bodega) y lo cobrado (Factura).';
  readonly conceptOverpay =
    'Monto total de cobros en exceso detectados y corregidos mediante la validación contable.';

  pieCanvas = viewChild<ElementRef<HTMLCanvasElement>>('pieCanvas');
  barCanvas = viewChild<ElementRef<HTMLCanvasElement>>('barCanvas');
  lineCanvas = viewChild<ElementRef<HTMLCanvasElement>>('lineCanvas');

  private chartPie: Chart | null = null;
  private chartBar: Chart | null = null;
  private chartLine: Chart | null = null;

  ngOnInit() {
    const to = new Date();
    const from = new Date(to.getTime() - 365 * 24 * 60 * 60 * 1000);
    this.dateFrom.set(toInputDate(from));
    this.dateTo.set(toInputDate(to));

    this.contractsService.findAll().subscribe({
      next: (c) => this.contracts.set(c),
      error: () => this.contracts.set([]),
    });
    this.load();
  }

  canSeeFinancialSavings(): boolean {
    const role = this.auth.currentUser()?.role;
    return role === 'ADMIN' || role === 'SUPER_ADMIN';
  }

  ngOnDestroy() {
    this.destroyCharts();
  }

  load() {
    this.isLoading.set(true);
    this.refreshPurchaseWidgets();
    const cid = this.contractId().trim();
    this.purchasesService
      .getPurchasesAnalyticsDashboard({
        from: new Date(this.dateFrom()).toISOString(),
        to: new Date(this.dateTo() + 'T23:59:59.999').toISOString(),
        ...(cid ? { contractId: cid } : {}),
      })
      .subscribe({
        next: (data) => {
          this.dashboard.set(data);
          this.loadVendorsPerformance();
          this.loadSavingsVariation();
          this.isLoading.set(false);
          setTimeout(() => this.renderCharts(data), 0);
        },
        error: (err: unknown) => {
          const msg =
            err && typeof err === 'object' && 'error' in err
              ? (err as { error?: { message?: string } }).error?.message
              : undefined;
          this.notify.error(
            typeof msg === 'string' ? msg : 'Error al cargar analítica',
          );
          this.isLoading.set(false);
        },
      });
  }

  /** Carga listas ligeras para accesos rápidos (quick view) alineadas al contrato seleccionado. */
  private refreshPurchaseWidgets() {
    const cid = this.contractId().trim();
    forkJoin({
      orders: this.purchasesService.getOrders(),
      invoices: this.purchasesService.listPurchaseInvoices({
        status: 'PENDING',
        ...(cid ? { contractId: cid } : {}),
      }),
    }).subscribe({
      next: ({ orders, invoices }) => {
        let ords = [...orders];
        if (cid) {
          ords = ords.filter((o) => o.contractId === cid);
        }
        ords.sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );
        this.recentPurchaseOrders.set(ords.slice(0, 5));
        this.pendingReconcileInvoices.set(invoices.slice(0, 8));
      },
      error: () => {
        this.recentPurchaseOrders.set([]);
        this.pendingReconcileInvoices.set([]);
      },
    });
  }

  exportExecutiveReport() {
    if (!this.canExportExecutiveReport()) {
      const hint = this.exportPdfHint().trim();
      if (hint) {
        this.notify.warning(hint);
      }
      return;
    }
    const cid = this.contractId().trim();
    this.isExportingPdf.set(true);
    this.purchasesService
      .downloadExecutiveReport({
        from: new Date(this.dateFrom()).toISOString(),
        to: new Date(this.dateTo() + 'T23:59:59.999').toISOString(),
        ...(cid ? { contractId: cid } : {}),
      })
      .pipe(finalize(() => this.isExportingPdf.set(false)))
      .subscribe({
        next: ({ blob, filename }) => {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = filename;
          a.rel = 'noopener';
          a.click();
          URL.revokeObjectURL(url);
        },
        error: (err: unknown) => {
          const blob =
            err instanceof HttpErrorResponse && err.error instanceof Blob
              ? err.error
              : null;
          if (blob) {
            blob.text().then((t) => {
              try {
                const j = JSON.parse(t) as { message?: string };
                this.notify.error(
                  typeof j.message === 'string'
                    ? j.message
                    : 'No se pudo generar el reporte PDF',
                );
              } catch {
                this.notify.error('No se pudo generar el reporte PDF');
              }
            });
            return;
          }
          const msg =
            err && typeof err === 'object' && 'message' in err
              ? String((err as { message?: string }).message)
              : '';
          this.notify.error(
            msg || 'No se pudo generar el reporte PDF',
          );
        },
      });
  }

  private destroyCharts() {
    this.chartPie?.destroy();
    this.chartBar?.destroy();
    this.chartLine?.destroy();
    this.chartPie = this.chartBar = this.chartLine = null;
  }

  private renderCharts(d: PurchasesAnalyticsDashboard) {
    this.destroyCharts();
    const pieEl = this.pieCanvas()?.nativeElement;
    const barEl = this.barCanvas()?.nativeElement;
    const lineEl = this.lineCanvas()?.nativeElement;
    if (!pieEl || !barEl || !lineEl) return;

    const imp = d.imputationSpend;
    const pieTotal = imp.general + imp.equipment + imp.workOrder;
    if (pieTotal > 0) {
      this.chartPie = new Chart(pieEl, {
        type: 'doughnut',
        data: {
          labels: ['Gasto general', 'Por equipo', 'Por OT'],
          datasets: [
            {
              data: [imp.general, imp.equipment, imp.workOrder],
              backgroundColor: [
                'rgba(148, 163, 184, 0.65)',
                'rgba(59, 130, 246, 0.7)',
                'rgba(34, 197, 94, 0.65)',
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

    const vendors = d.topVendors;
    if (vendors.length) {
      this.chartBar = new Chart(barEl, {
        type: 'bar',
        data: {
          labels: vendors.map((v) => v.vendorName),
          datasets: [
            {
              label: 'Volumen de compra (CLP)',
              data: vendors.map((v) => v.purchaseVolume),
              backgroundColor: 'rgba(236, 72, 153, 0.55)',
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            x: { ticks: { color: '#94a3b8', maxRotation: 45 } },
            y: {
              ticks: { color: '#94a3b8' },
              beginAtZero: true,
            },
          },
          plugins: {
            legend: { labels: { color: '#94a3b8' } },
            tooltip: {
              callbacks: {
                afterBody: (items) => {
                  const i = items[0]?.dataIndex;
                  if (i == null) return [];
                  const lt = vendors[i]?.avgLeadTimeDays;
                  return lt != null
                    ? [`Lead time medio: ${lt} días`]
                    : ['Lead time: —'];
                },
              },
            },
          },
        },
      });
    }

    const months = d.monthlySpend;
    if (months.length) {
      this.chartLine = new Chart(lineEl, {
        type: 'line',
        data: {
          labels: months.map((m) => {
            const x = new Date(m.month);
            return x.toLocaleDateString('es-CL', {
              month: 'short',
              year: '2-digit',
            });
          }),
          datasets: [
            {
              label: 'Gasto aprobado (CLP)',
              data: months.map((m) => m.total),
              borderColor: 'rgba(244, 114, 182, 0.9)',
              backgroundColor: 'rgba(244, 114, 182, 0.15)',
              fill: true,
              tension: 0.25,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            x: { ticks: { color: '#94a3b8' } },
            y: {
              ticks: { color: '#94a3b8' },
              beginAtZero: true,
            },
          },
          plugins: { legend: { labels: { color: '#94a3b8' } } },
        },
      });
    }
  }

  private loadVendorsPerformance() {
    this.inventoryAnalytics
      .getVendorsPerformance({
        from: new Date(this.dateFrom()).toISOString(),
        to: new Date(this.dateTo() + 'T23:59:59.999').toISOString(),
      })
      .subscribe({
        next: (resp) => this.vendorsPerformance.set(resp.vendors),
        error: () => this.vendorsPerformance.set([]),
      });
  }

  private loadSavingsVariation() {
    if (!this.canSeeFinancialSavings()) {
      this.savingsVariation.set(null);
      return;
    }
    const month = this.dateTo().slice(0, 7);
    this.inventoryAnalytics.getSavingsVariation(month).subscribe({
      next: (resp) => this.savingsVariation.set(resp),
      error: () => this.savingsVariation.set(null),
    });
  }
}
