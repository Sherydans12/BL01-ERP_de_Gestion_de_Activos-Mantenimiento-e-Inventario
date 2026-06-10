import {
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import {
  FaultReportsService,
  FaultReportRow,
  FaultReportListParams,
  FaultCriticality,
  FaultReportStatus,
  CRITICALITY_META,
  STATUS_META,
  SYSTEM_LABELS,
  FAULT_CRITICALITIES,
} from '../../../core/services/fault-reports/fault-reports.service';
import { FleetService } from '../../../core/services/fleet/fleet.service';
import { NotificationService } from '../../../core/services/notification/notification.service';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { O } from '../../../core/constants/operations-permissions';

const PAGE_SIZE = 20;

@Component({
  selector: 'app-fault-report-list',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, HasPermissionDirective],
  templateUrl: './fault-report-list.component.html',
})
export class FaultReportListComponent implements OnInit {
  protected readonly O                = O;
  protected readonly CRITICALITY_META = CRITICALITY_META;
  protected readonly STATUS_META      = STATUS_META;
  protected readonly SYSTEM_LABELS    = SYSTEM_LABELS;
  protected readonly FAULT_CRITICALITIES = FAULT_CRITICALITIES;
  protected readonly STATUS_OPTIONS: FaultReportStatus[] = ['OPEN', 'LINKED', 'CLOSED'];

  private faultService = inject(FaultReportsService);
  private fleetSvc     = inject(FleetService);
  private notify       = inject(NotificationService);

  // ── Catálogos para filtros ────────────────────────────────────────────────
  equipments = signal<any[]>([]);

  // ── Filtros ───────────────────────────────────────────────────────────────
  filterEquipmentId = signal<string>('');
  filterCriticality = signal<FaultCriticality | ''>('');
  filterStatus      = signal<FaultReportStatus | ''>('');
  filterDateFrom    = signal<string>('');
  filterDateTo      = signal<string>('');

  // ── Estado de tabla ───────────────────────────────────────────────────────
  rows    = signal<FaultReportRow[]>([]);
  total   = signal(0);
  page    = signal(1);
  loading = signal(false);

  /** ID de fila con OT generándose (spinner por fila). */
  generatingOtForId = signal<string | null>(null);

  totalPages  = computed(() => Math.max(1, Math.ceil(this.total() / PAGE_SIZE)));
  pageNumbers = computed(() => Array.from({ length: this.totalPages() }, (_, i) => i + 1));

  ngOnInit(): void {
    this.fleetSvc.getEquipments({ limit: 200 }).subscribe({
      next: (res) => this.equipments.set(res.data ?? []),
      error: () => { /* no bloquea la carga */ },
    });
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    const params: FaultReportListParams = {
      page:        this.page(),
      pageSize:    PAGE_SIZE,
      equipmentId: this.filterEquipmentId() || undefined,
      criticality: (this.filterCriticality() as FaultCriticality) || undefined,
      status:      (this.filterStatus() as FaultReportStatus) || undefined,
      dateFrom:    this.filterDateFrom() || undefined,
      dateTo:      this.filterDateTo() || undefined,
    };
    this.faultService.getReports(params).subscribe({
      next: (res) => {
        this.rows.set(res.data);
        this.total.set(res.total);
        this.loading.set(false);
      },
      error: () => {
        this.notify.error('No se pudo cargar el historial de fallas.');
        this.loading.set(false);
      },
    });
  }

  applyFilters(): void {
    this.page.set(1);
    this.load();
  }

  clearFilters(): void {
    this.filterEquipmentId.set('');
    this.filterCriticality.set('');
    this.filterStatus.set('');
    this.filterDateFrom.set('');
    this.filterDateTo.set('');
    this.page.set(1);
    this.load();
  }

  goToPage(p: number): void {
    if (p < 1 || p > this.totalPages()) return;
    this.page.set(p);
    this.load();
  }

  generateWorkOrder(row: FaultReportRow): void {
    this.generatingOtForId.set(row.id);
    this.faultService.createWorkOrder(row.id).subscribe({
      next: (updated) => {
        this.notify.success(
          `OT ${updated.workOrder?.correlative ?? ''} generada para ${row.correlative}.`,
        );
        this.generatingOtForId.set(null);
        this.load();
      },
      error: (err) => {
        const msg: string = err?.error?.message ?? 'No se pudo generar la OT.';
        this.notify.error(msg);
        this.generatingOtForId.set(null);
      },
    });
  }

  equipmentLabel(row: FaultReportRow): string {
    const e = row.equipment;
    const base = [e.internalId, `${e.brand} ${e.model}`].filter(Boolean).join(' — ');
    return e.plate ? `${base} (${e.plate})` : base;
  }
}
