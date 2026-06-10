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
  EquipmentAvailabilityService,
  AvailabilityRecord,
  AvailabilityListParams,
  SHIFTS,
  SHIFT_LABELS,
  STATUS_LABELS,
  STATUS_COLORS,
  ShiftType,
} from '../../../core/services/equipment-availability/equipment-availability.service';
import { FleetService } from '../../../core/services/fleet/fleet.service';
import { AuthService } from '../../../core/services/auth/auth.service';
import { ContractsService } from '../../../core/services/contracts/contracts.service';
import { NotificationService } from '../../../core/services/notification/notification.service';
import { ShiftService } from '../../../core/services/shift/shift.service';
import type { Contract } from '../../../core/models/types';
import { O } from '../../../core/constants/operations-permissions';

const PAGE_SIZE = 20;

@Component({
  selector: 'app-availability-history',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './availability-history.component.html',
})
export class AvailabilityHistoryComponent implements OnInit {
  protected readonly O = O;
  protected readonly SHIFTS = SHIFTS;
  protected readonly SHIFT_LABELS = SHIFT_LABELS;
  protected readonly STATUS_LABELS = STATUS_LABELS;
  protected readonly STATUS_COLORS = STATUS_COLORS;

  private availabilityService = inject(EquipmentAvailabilityService);
  private fleetSvc = inject(FleetService);
  private contractsService = inject(ContractsService);
  private notify = inject(NotificationService);
  protected readonly shiftService = inject(ShiftService);
  protected readonly authService = inject(AuthService);

  protected readonly shiftFilterOptions = computed(() =>
    this.shiftService.selectableShifts(),
  );

  equipments = signal<Array<{ id: string; internalId: string; brand: string; model: string }>>([]);
  contracts = signal<Contract[]>([]);

  filterEquipmentId = signal('');
  filterShift = signal<ShiftType | ''>('');
  filterContractId = signal('');
  filterDateFrom = signal('');
  filterDateTo = signal('');
  searchDraft = signal('');

  rows = signal<AvailabilityRecord[]>([]);
  total = signal(0);
  page = signal(1);
  loading = signal(false);

  totalPages = computed(() => Math.max(1, Math.ceil(this.total() / PAGE_SIZE)));

  contractOptions = computed(() => {
    const all = this.contracts();
    const role = this.authService.currentUser()?.role;
    const allowed = this.authService.currentUser()?.allowedContracts ?? [];
    if (role === 'ADMIN' || role === 'SUPER_ADMIN' || allowed.includes('ALL')) {
      return all;
    }
    return all.filter((c) => allowed.includes(c.id));
  });

  ngOnInit(): void {
    this.fleetSvc.getEquipments({ limit: 200 }).subscribe({
      next: (res) => this.equipments.set(res.data ?? []),
      error: () => { /* no bloquea */ },
    });
    this.contractsService.findAll().subscribe({
      next: (list) => this.contracts.set(list.filter((c) => c.isActive !== false)),
    });
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    const params: AvailabilityListParams = {
      page: this.page(),
      pageSize: PAGE_SIZE,
      equipmentId: this.filterEquipmentId() || undefined,
      shift: this.filterShift()
        ? this.shiftService.coerceShift(this.filterShift())
        : undefined,
      contractId: this.filterContractId() || undefined,
      dateFrom: this.filterDateFrom() || undefined,
      dateTo: this.filterDateTo() || undefined,
      search: this.searchDraft().trim() || undefined,
    };
    this.availabilityService.getAll(params).subscribe({
      next: (res) => {
        this.rows.set(res.data);
        this.total.set(res.total);
        this.loading.set(false);
      },
      error: () => {
        this.notify.error('No se pudo cargar el historial de disponibilidad.');
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
    this.filterShift.set('');
    this.filterContractId.set('');
    this.filterDateFrom.set('');
    this.filterDateTo.set('');
    this.searchDraft.set('');
    this.page.set(1);
    this.load();
  }

  goToPage(p: number): void {
    if (p < 1 || p > this.totalPages()) return;
    this.page.set(p);
    this.load();
  }

  formatDate(iso: string): string {
    return iso.slice(0, 10);
  }
}
