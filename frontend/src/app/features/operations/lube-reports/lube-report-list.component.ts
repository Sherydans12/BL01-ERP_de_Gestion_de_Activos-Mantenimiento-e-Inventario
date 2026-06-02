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
  LubeReportsService,
  LubeReportRow,
  LubeReportListParams,
} from '../../../core/services/lube-reports/lube-reports.service';
import { WarehousesService } from '../../../core/services/warehouses/warehouses.service';
import { FleetService } from '../../../core/services/fleet/fleet.service';
import { NotificationService } from '../../../core/services/notification/notification.service';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { O } from '../../../core/constants/operations-permissions';

const PAGE_SIZE = 20;

@Component({
  selector: 'app-lube-report-list',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, HasPermissionDirective],
  templateUrl: './lube-report-list.component.html',
})
export class LubeReportListComponent implements OnInit {
  protected readonly O = O;

  private lubeService    = inject(LubeReportsService);
  private warehousesSvc  = inject(WarehousesService);
  private fleetSvc       = inject(FleetService);
  private notify         = inject(NotificationService);

  // ── Catálogos para filtros ────────────────────────────────────────────
  warehouses = signal<any[]>([]);
  equipments = signal<any[]>([]);

  // ── Filtros activos ───────────────────────────────────────────────────
  filterWarehouseId  = signal<string>('');
  filterEquipmentId  = signal<string>('');
  filterDateFrom     = signal<string>('');
  filterDateTo       = signal<string>('');

  // ── Estado de la tabla ────────────────────────────────────────────────
  rows        = signal<LubeReportRow[]>([]);
  total       = signal(0);
  page        = signal(1);
  loading     = signal(false);

  totalPages = computed(() => Math.max(1, Math.ceil(this.total() / PAGE_SIZE)));
  pageNumbers = computed(() =>
    Array.from({ length: this.totalPages() }, (_, i) => i + 1),
  );

  ngOnInit(): void {
    this.warehousesSvc.getWarehouses().subscribe({
      next: (data) => this.warehouses.set(data),
      error: () => { /* no bloquea */ },
    });
    this.fleetSvc.getEquipments({ limit: 200 }).subscribe({
      next: (res) => this.equipments.set(res.data),
      error: () => { /* no bloquea */ },
    });
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    const params: LubeReportListParams = {
      page: this.page(),
      pageSize: PAGE_SIZE,
      warehouseId:  this.filterWarehouseId() || undefined,
      equipmentId:  this.filterEquipmentId() || undefined,
      dateFrom:     this.filterDateFrom() || undefined,
      dateTo:       this.filterDateTo() || undefined,
    };
    this.lubeService.getReports(params).subscribe({
      next: (res) => {
        this.rows.set(res.data);
        this.total.set(res.total);
        this.loading.set(false);
      },
      error: () => {
        this.notify.error('No se pudo cargar el historial de despachos.');
        this.loading.set(false);
      },
    });
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

  goToPage(p: number): void {
    if (p < 1 || p > this.totalPages()) return;
    this.page.set(p);
    this.load();
  }

  equipmentLabel(row: LubeReportRow): string {
    const e = row.equipment;
    const parts = [e.internalId, e.name].filter(Boolean).join(' — ');
    return e.licensePlate ? `${parts} (${e.licensePlate})` : parts;
  }
}
