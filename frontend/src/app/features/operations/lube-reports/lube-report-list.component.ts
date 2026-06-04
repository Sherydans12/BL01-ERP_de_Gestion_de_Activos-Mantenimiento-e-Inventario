import {
  Component,
  OnInit,
  computed,
  inject,
  signal,
  DestroyRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, debounceTime, distinctUntilChanged } from 'rxjs';

import {
  LubeReportsService,
  LubeReportRow,
  LubeReportListParams,
  LubeReportListSortField,
  LubeReportDetail,
} from '../../../core/services/lube-reports/lube-reports.service';
import { WarehousesService } from '../../../core/services/warehouses/warehouses.service';
import { FleetService } from '../../../core/services/fleet/fleet.service';
import { NotificationService } from '../../../core/services/notification/notification.service';
import { DeviceService } from '../../../core/services/device/device.service';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { O } from '../../../core/constants/operations-permissions';
import { LubeReportDetailModalComponent } from './lube-report-detail-modal/lube-report-detail-modal.component';

@Component({
  selector: 'app-lube-report-list',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    HasPermissionDirective,
    LubeReportDetailModalComponent,
  ],
  templateUrl: './lube-report-list.component.html',
})
export class LubeReportListComponent implements OnInit {
  protected readonly O = O;

  private lubeService = inject(LubeReportsService);
  private warehousesSvc = inject(WarehousesService);
  private fleetSvc = inject(FleetService);
  private notify = inject(NotificationService);
  private destroyRef = inject(DestroyRef);
  protected deviceService = inject(DeviceService);

  readonly pageSizeOptions = [10, 25, 50, 100] as const;

  warehouses = signal<any[]>([]);
  equipments = signal<any[]>([]);

  filterWarehouseId = signal<string>('');
  filterEquipmentId = signal<string>('');
  filterDateFrom = signal<string>('');
  filterDateTo = signal<string>('');

  searchQuery = signal('');
  private search$ = new Subject<string>();

  sortField = signal<LubeReportListSortField>('dispatchDate');
  sortDir = signal<'asc' | 'desc'>('desc');

  rows = signal<LubeReportRow[]>([]);
  total = signal(0);
  page = signal(1);
  pageSize = signal(25);
  loading = signal(false);

  detailOpen = signal(false);
  detailLoading = signal(false);
  detailReport = signal<LubeReportDetail | null>(null);
  detailError = signal<string | null>(null);

  hasActiveSearch = computed(() => !!this.searchQuery().trim());

  hasActiveFilters = computed(
    () =>
      !!this.filterWarehouseId() ||
      !!this.filterEquipmentId() ||
      !!this.filterDateFrom() ||
      !!this.filterDateTo(),
  );

  totalPages = computed(() =>
    Math.max(1, Math.ceil(this.total() / this.pageSize())),
  );

  rangeFrom = computed(() =>
    this.total() === 0 ? 0 : (this.page() - 1) * this.pageSize() + 1,
  );

  rangeTo = computed(() =>
    Math.min(this.page() * this.pageSize(), this.total()),
  );

  ngOnInit(): void {
    this.search$
      .pipe(
        debounceTime(350),
        distinctUntilChanged(),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        this.page.set(1);
        this.load();
      });

    this.warehousesSvc.getWarehouses().subscribe({
      next: (data) => this.warehouses.set(data),
      error: () => { /* no bloquea */ },
    });
    this.fleetSvc.getEquipments({ limit: 500 }).subscribe({
      next: (res) => this.equipments.set(res.data ?? []),
      error: () => { /* no bloquea */ },
    });
    this.load();
  }

  private listParams(): LubeReportListParams {
    const params: LubeReportListParams = {
      page: this.page(),
      pageSize: this.pageSize(),
      sort: this.sortField(),
      dir: this.sortDir(),
      warehouseId: this.filterWarehouseId() || undefined,
      equipmentId: this.filterEquipmentId() || undefined,
      dateFrom: this.filterDateFrom() || undefined,
      dateTo: this.filterDateTo() || undefined,
    };
    const s = this.searchQuery().trim();
    if (s) params.search = s;
    return params;
  }

  private load(): void {
    this.loading.set(true);
    this.lubeService.getReports(this.listParams()).subscribe({
      next: (res) => {
        this.rows.set(res.data);
        this.total.set(res.total);
        this.page.set(res.page);
        this.pageSize.set(res.pageSize);
        this.loading.set(false);
      },
      error: () => {
        this.notify.error('No se pudo cargar el historial de despachos.');
        this.loading.set(false);
      },
    });
  }

  onSearchChange(value: string): void {
    this.searchQuery.set(value);
    this.search$.next(value.trim());
  }

  onSearchEnter(event: Event): void {
    event.preventDefault();
    const v = (event.target as HTMLInputElement).value?.trim() ?? '';
    this.searchQuery.set(v);
    this.page.set(1);
    this.load();
  }

  clearSearch(): void {
    this.searchQuery.set('');
    this.page.set(1);
    this.load();
  }

  onSortFieldChange(value: string): void {
    if (!this.isSortField(value)) return;
    this.sortField.set(value);
    this.page.set(1);
    this.applyDefaultDirForField(value);
    this.load();
  }

  onSortDirChange(value: string): void {
    if (value !== 'asc' && value !== 'desc') return;
    this.sortDir.set(value);
    this.page.set(1);
    this.load();
  }

  onPageSizeChange(value: unknown): void {
    const n = typeof value === 'string' ? parseInt(value, 10) : Number(value);
    if (!Number.isFinite(n) || n < 1) return;
    this.pageSize.set(Math.min(100, n));
    this.page.set(1);
    this.load();
  }

  applyFilters(): void {
    this.page.set(1);
    this.load();
  }

  clearFilters(): void {
    this.filterWarehouseId.set('');
    this.filterEquipmentId.set('');
    this.filterDateFrom.set('');
    this.filterDateTo.set('');
    this.page.set(1);
    this.load();
  }

  prevPage(): void {
    if (this.page() <= 1) return;
    this.page.update((p) => p - 1);
    this.load();
  }

  nextPage(): void {
    if (this.page() >= this.totalPages()) return;
    this.page.update((p) => p + 1);
    this.load();
  }

  openDetail(id: string): void {
    this.detailOpen.set(true);
    this.detailLoading.set(true);
    this.detailReport.set(null);
    this.detailError.set(null);

    this.lubeService.getReport(id).subscribe({
      next: (detail) => {
        this.detailReport.set(detail);
        this.detailLoading.set(false);
      },
      error: (err) => {
        const msg =
          err?.error?.message ??
          'No se pudo cargar el detalle del despacho.';
        this.detailError.set(
          typeof msg === 'string' ? msg : 'No se pudo cargar el detalle del despacho.',
        );
        this.detailLoading.set(false);
      },
    });
  }

  closeDetail(): void {
    this.detailOpen.set(false);
    this.detailReport.set(null);
    this.detailError.set(null);
  }

  private isSortField(v: string): v is LubeReportListSortField {
    return (
      v === 'dispatchDate' ||
      v === 'correlative' ||
      v === 'createdAt' ||
      v === 'meterReading' ||
      v === 'warehouseName' ||
      v === 'equipmentInternalId' ||
      v === 'userName'
    );
  }

  private applyDefaultDirForField(field: LubeReportListSortField): void {
    if (
      field === 'dispatchDate' ||
      field === 'createdAt' ||
      field === 'meterReading'
    ) {
      this.sortDir.set('desc');
    } else {
      this.sortDir.set('asc');
    }
  }

  equipmentLabel(row: LubeReportRow): string {
    const e = row.equipment;
    const parts = [e.internalId, `${e.brand} ${e.model}`].filter(Boolean).join(' — ');
    return e.plate ? `${parts} (${e.plate})` : parts;
  }
}
