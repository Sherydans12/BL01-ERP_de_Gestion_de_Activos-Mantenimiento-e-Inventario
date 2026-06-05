import {
  Component,
  OnDestroy,
  OnInit,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink, ActivatedRoute } from '@angular/router';
import { Subject, debounceTime, distinctUntilChanged } from 'rxjs';

import { NotificationService } from '../../../core/services/notification/notification.service';
import { ShiftService } from '../../../core/services/shift/shift.service';
import { AuthService } from '../../../core/services/auth/auth.service';
import { ContractsService } from '../../../core/services/contracts/contracts.service';
import { DeviceService } from '../../../core/services/device/device.service';
import {
  EquipmentAvailabilityService,
  SHIFTS,
  SHIFT_LABELS,
  STATUS_COLORS,
  STATUS_LABELS,
  ShiftType,
  ShiftBoardRow,
  ShiftBoardSummary,
  ShiftBoardTab,
  OperationalStatus,
} from '../../../core/services/equipment-availability/equipment-availability.service';
import { EquipmentDetailModalComponent } from '../../fleet/equipment-detail-modal/equipment-detail-modal.component';
import type { Contract } from '../../../core/models/types';
import { O } from '../../../core/constants/operations-permissions';

const PAGE_SIZE = 25;
const AUTO_REFRESH_MS = 5 * 60_000;

const STATUS_DOT: Record<OperationalStatus, string> = {
  OPERATIONAL: 'bg-green-400',
  STANDBY: 'bg-blue-400',
  RESERVE_NO_OPERATOR: 'bg-yellow-400',
  DOWN_FAILURE: 'bg-red-400',
  DOWN_MAINTENANCE: 'bg-orange-400',
};

const TAB_OPTIONS: { id: ShiftBoardTab; label: string }[] = [
  { id: 'ALL', label: 'Todos' },
  { id: 'REPORTED', label: 'Reportados' },
  { id: 'PENDING', label: 'Pendientes' },
  { id: 'EXCLUDED', label: 'Fuera de servicio' },
];

@Component({
  selector: 'app-availability-monitor',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, EquipmentDetailModalComponent],
  templateUrl: './availability-monitor.component.html',
})
export class AvailabilityMonitorComponent implements OnInit, OnDestroy {
  protected readonly O = O;
  protected readonly SHIFTS = SHIFTS;
  protected readonly SHIFT_LABELS = SHIFT_LABELS;
  protected readonly STATUS_LABELS = STATUS_LABELS;
  protected readonly STATUS_COLORS = STATUS_COLORS;
  protected readonly STATUS_DOT = STATUS_DOT;
  protected readonly TAB_OPTIONS = TAB_OPTIONS;
  protected readonly PAGE_SIZE = PAGE_SIZE;

  private availabilityService = inject(EquipmentAvailabilityService);
  private contractsService = inject(ContractsService);
  private route = inject(ActivatedRoute);
  private notify = inject(NotificationService);
  protected readonly authService = inject(AuthService);
  protected readonly deviceService = inject(DeviceService);
  protected readonly shiftService = inject(ShiftService);

  filterDate = signal<string>('');
  filterShift = signal<ShiftType>('DAY');
  filterContractId = signal<string>('');
  filterTab = signal<ShiftBoardTab>('ALL');
  searchDraft = signal('');
  searchQuery = signal('');

  rows = signal<ShiftBoardRow[]>([]);
  summary = signal<ShiftBoardSummary | null>(null);
  totalRows = signal(0);
  page = signal(1);
  isLoading = signal(false);
  isExporting = signal(false);
  lastQueried = signal<string | null>(null);

  contracts = signal<Contract[]>([]);
  showEquipmentDetail = signal(false);
  detailEquipmentId = signal<string | null>(null);

  private searchSubject = new Subject<string>();
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  totalPages = computed(() =>
    Math.max(1, Math.ceil(this.totalRows() / PAGE_SIZE)),
  );

  pageNumbers = computed(() =>
    Array.from({ length: this.totalPages() }, (_, i) => i + 1),
  );

  isAdminScope = computed(() => {
    const role = this.authService.currentUser()?.role;
    return role === 'ADMIN' || role === 'SUPER_ADMIN';
  });

  contractOptions = computed(() => {
    const all = this.contracts();
    const allowed = this.authService.currentUser()?.allowedContracts ?? [];
    if (this.isAdminScope() || allowed.includes('ALL')) {
      return all;
    }
    return all.filter((c) => allowed.includes(c.id));
  });

  get maxDate(): string {
    return this.shiftService.todayIso();
  }

  constructor() {
    effect(() => {
      if (!this.shiftService.hasNightShift() && this.filterShift() === 'NIGHT') {
        this.filterShift.set('DAY');
        this.query(false);
      }
    });
  }

  ngOnInit(): void {
    const qp = this.route.snapshot.queryParamMap;
    this.filterDate.set(qp.get('date') ?? this.shiftService.todayIso());
    this.filterShift.set(this.shiftService.coerceShift(qp.get('shift')));
    const tab = qp.get('tab');
    if (tab === 'PENDING' || tab === 'REPORTED' || tab === 'EXCLUDED' || tab === 'ALL') {
      this.filterTab.set(tab);
    }

    this.contractsService.findAll().subscribe({
      next: (list) => this.contracts.set(list.filter((c) => c.isActive !== false)),
      error: () => { /* no bloquea */ },
    });

    this.searchSubject
      .pipe(debounceTime(300), distinctUntilChanged())
      .subscribe((q) => {
        this.searchQuery.set(q);
        this.page.set(1);
        this.query();
      });

    this.query();
    this.refreshTimer = setInterval(() => this.query(false), AUTO_REFRESH_MS);
  }

  ngOnDestroy(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
  }

  onSearchDraftChange(v: string): void {
    this.searchDraft.set(v);
    this.searchSubject.next(v);
  }

  onDateChange(v: string): void {
    this.filterDate.set(v);
  }

  onShiftChange(v: ShiftType): void {
    this.filterShift.set(this.shiftService.coerceShift(v));
  }

  onContractChange(v: string): void {
    this.filterContractId.set(v);
    this.page.set(1);
    this.query();
  }

  setTab(tab: ShiftBoardTab): void {
    this.filterTab.set(tab);
    this.page.set(1);
    this.query();
  }

  applyFilters(): void {
    this.page.set(1);
    this.query();
  }

  goToPage(p: number): void {
    if (p < 1 || p > this.totalPages()) return;
    this.page.set(p);
    this.query(false);
  }

  query(showLoading = true): void {
    if (showLoading) this.isLoading.set(true);

    const contractId = this.filterContractId() || undefined;

    this.availabilityService
      .getShiftBoard({
        date: this.filterDate(),
        shift: this.filterShift(),
        contractId,
        search: this.searchQuery() || undefined,
        tab: this.filterTab(),
        page: this.page(),
        pageSize: PAGE_SIZE,
      })
      .subscribe({
        next: (res) => {
          this.rows.set(res.rows);
          this.summary.set(res.summary);
          this.totalRows.set(res.total);
          this.lastQueried.set(
            `${this.filterDate()} — ${SHIFT_LABELS[this.filterShift()]}`,
          );
          this.isLoading.set(false);
        },
        error: () => {
          this.notify.error('No se pudo consultar el estado de la flota.');
          this.isLoading.set(false);
        },
      });
  }

  exportTemplate(): void {
    this.isExporting.set(true);
    this.availabilityService
      .exportTemplate(
        this.filterDate(),
        this.filterShift(),
        this.filterContractId() || undefined,
      )
      .subscribe({
        next: () => this.isExporting.set(false),
        error: () => {
          this.notify.error('No se pudo descargar la plantilla Excel.');
          this.isExporting.set(false);
        },
      });
  }

  openEquipmentDetail(equipmentId: string): void {
    this.detailEquipmentId.set(equipmentId);
    this.showEquipmentDetail.set(true);
  }

  reportLink(equipmentId: string): string[] {
    return ['/app/operaciones/disponibilidad/nuevo'];
  }

  reportQueryParams(equipmentId: string): Record<string, string> {
    return {
      equipmentId,
      date: this.filterDate(),
      shift: this.filterShift(),
    };
  }

  formatReportedAt(iso: string | null | undefined): string {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString('es-CL', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '—';
    }
  }

  contractLabel(contractId: string | null): string {
    if (!contractId) return 'Sin contrato';
    const c = this.contracts().find((x) => x.id === contractId);
    return c ? `${c.code}` : contractId.slice(0, 8);
  }

  statusBreakdownEntries(summary: ShiftBoardSummary): Array<{ status: OperationalStatus; count: number }> {
    return (Object.keys(summary.byStatus) as OperationalStatus[])
      .map((status) => ({ status, count: summary.byStatus[status] }))
      .filter((e) => e.count > 0);
  }

  hasPendingFaultRegistration(equipmentId: string): boolean {
    return this.availabilityService.hasPendingFaultRegistration(equipmentId);
  }
}
