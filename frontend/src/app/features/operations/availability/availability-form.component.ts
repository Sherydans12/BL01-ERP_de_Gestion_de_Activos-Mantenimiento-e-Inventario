import {
  Component,
  OnInit,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Observable, Subject, debounceTime, distinctUntilChanged } from 'rxjs';

import { NotificationService } from '../../../core/services/notification/notification.service';
import { ShiftService } from '../../../core/services/shift/shift.service';
import { AuthService } from '../../../core/services/auth/auth.service';
import { ContractsService } from '../../../core/services/contracts/contracts.service';
import { EquipmentMeterSnapshotService } from '../../../core/services/equipment-meter/equipment-meter-snapshot.service';
import {
  EquipmentAvailabilityService,
  CreateAvailabilityPayload,
  AvailabilitySideEffect,
  SHIFTS,
  OPERATIONAL_STATUSES,
  SHIFT_LABELS,
  STATUS_LABELS,
  ShiftType,
  OperationalStatus,
  UnreportedEquipment,
} from '../../../core/services/equipment-availability/equipment-availability.service';
import { ConfirmModalComponent } from '../../../shared/components/confirm-modal/confirm-modal.component';
import { MeterReferenceBannerComponent } from '../../../shared/components/meter-reference-banner/meter-reference-banner.component';
import type { Contract, EquipmentMeterSnapshot } from '../../../core/models/types';
import { O } from '../../../core/constants/operations-permissions';

export interface DraftAvailability {
  status: OperationalStatus | null;
  meterReading: number | null;
  comments: string;
}

const STATUS_DOT: Record<OperationalStatus, string> = {
  OPERATIONAL: 'bg-green-400',
  STANDBY: 'bg-blue-400',
  RESERVE_NO_OPERATOR: 'bg-yellow-400',
  DOWN_FAILURE: 'bg-red-400',
  DOWN_MAINTENANCE: 'bg-orange-400',
};

const PAGE_SIZE = 10;

@Component({
  selector: 'app-availability-form',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    ConfirmModalComponent,
    MeterReferenceBannerComponent,
  ],
  templateUrl: './availability-form.component.html',
})
export class AvailabilityFormComponent implements OnInit {
  protected readonly O = O;
  protected readonly SHIFTS = SHIFTS;
  protected readonly OPERATIONAL_STATUSES = OPERATIONAL_STATUSES;
  protected readonly SHIFT_LABELS = SHIFT_LABELS;
  protected readonly STATUS_LABELS = STATUS_LABELS;
  protected readonly STATUS_DOT = STATUS_DOT;
  protected readonly PAGE_SIZE = PAGE_SIZE;

  private availabilityService = inject(EquipmentAvailabilityService);
  private contractsService = inject(ContractsService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private notify = inject(NotificationService);
  private meterSnapshotService = inject(EquipmentMeterSnapshotService);
  protected readonly shiftService = inject(ShiftService);
  protected readonly authService = inject(AuthService);

  reportDate = signal<string>('');
  shift = signal<ShiftType>('DAY');
  filterContractId = signal<string>('');
  searchDraft = signal('');
  searchQuery = signal('');
  compactView = signal(false);
  highlightEquipmentId = signal<string | null>(null);

  pendingEquipments = signal<UnreportedEquipment[]>([]);
  pendingTotal = signal(0);
  page = signal(1);
  isLoadingEquipments = signal(false);

  drafts = signal<Record<string, DraftAvailability>>({});
  meterSnapshots = signal<Record<string, EquipmentMeterSnapshot | null>>({});
  expandedMeterIds = signal<Set<string>>(new Set());

  isSubmitting = signal(false);
  contracts = signal<Contract[]>([]);

  private searchSubject = new Subject<string>();

  readyToSubmit = computed(() =>
    Object.entries(this.drafts()).filter(
      ([, v]) => v.status !== null,
    ) as [string, DraftAvailability & { status: OperationalStatus }][],
  );

  readyCount = computed(() => this.readyToSubmit().length);

  totalPages = computed(() =>
    Math.max(1, Math.ceil(this.pendingTotal() / PAGE_SIZE)),
  );

  isDirty = computed(() =>
    Object.values(this.drafts()).some(
      (v) => v.status !== null || v.meterReading != null || !!v.comments.trim(),
    ),
  );

  contractOptions = computed(() => {
    const all = this.contracts();
    const role = this.authService.currentUser()?.role;
    const allowed = this.authService.currentUser()?.allowedContracts ?? [];
    if (role === 'ADMIN' || role === 'SUPER_ADMIN' || allowed.includes('ALL')) {
      return all;
    }
    return all.filter((c) => allowed.includes(c.id));
  });

  leaveConfirmOpen = signal(false);
  private leaveResult$ = new Subject<boolean>();

  /** Modal M2→M3 tras detención por falla (sideEffects del orquestador). */
  faultCompletionConfirmOpen = signal(false);
  private pendingFaultSideEffect = signal<AvailabilitySideEffect | null>(null);
  private pendingFaultSymptom = signal<string | undefined>(undefined);
  private pendingFaultMeter = signal<number | undefined>(undefined);
  private shiftPinnedByUrl = false;
  private lastClockShift: ShiftType | null = null;

  get maxDate(): string {
    return this.shiftService.todayIso();
  }

  constructor() {
    effect(() => {
      const coerced = this.shiftService.coerceShift(this.shift());
      if (coerced !== this.shift()) {
        this.shift.set(coerced);
        this.loadPending();
        return;
      }
      if (!this.shiftService.operationalConfigLoaded() || this.shiftPinnedByUrl) {
        return;
      }
      const clockShift = this.shiftService.currentShift();
      if (this.lastClockShift === null) {
        this.lastClockShift = clockShift;
        const aligned = this.shiftService.alignShiftAfterConfigLoad(this.shift(), false);
        if (aligned !== this.shift()) {
          this.shift.set(aligned);
          this.loadPending();
        }
        return;
      }
      if (clockShift === this.lastClockShift) return;
      this.lastClockShift = clockShift;
      if (this.shift() !== clockShift) {
        this.shift.set(clockShift);
        this.loadPending();
      }
    });
  }

  ngOnInit(): void {
    const qp = this.route.snapshot.queryParamMap;
    this.shiftPinnedByUrl = qp.has('shift');
    this.reportDate.set(qp.get('date') ?? this.shiftService.todayIso());
    this.shift.set(this.shiftService.coerceShift(qp.get('shift')));
    this.highlightEquipmentId.set(qp.get('equipmentId'));

    this.contractsService.findAll().subscribe({
      next: (list) => this.contracts.set(list.filter((c) => c.isActive !== false)),
    });

    this.searchSubject
      .pipe(debounceTime(300), distinctUntilChanged())
      .subscribe((q) => {
        this.searchQuery.set(q);
        this.page.set(1);
        this.loadPending();
      });

    this.loadPending();
  }

  onSearchDraftChange(v: string): void {
    this.searchDraft.set(v);
    this.searchSubject.next(v);
  }

  onFilterChange(): void {
    this.page.set(1);
    this.loadPending();
  }

  goToPage(p: number): void {
    if (p < 1 || p > this.totalPages()) return;
    this.page.set(p);
    this.loadPending();
  }

  loadPending(): void {
    this.isLoadingEquipments.set(true);
    this.availabilityService
      .getUnreported({
        date: this.reportDate(),
        shift: this.shift(),
        contractId: this.filterContractId() || undefined,
        search: this.searchQuery() || undefined,
        page: this.page(),
        pageSize: PAGE_SIZE,
      })
      .subscribe({
        next: (res) => {
          this.pendingEquipments.set(res.data);
          this.pendingTotal.set(res.total);
          const initial: Record<string, DraftAvailability> = { ...this.drafts() };
          for (const eq of res.data) {
            if (!initial[eq.id]) {
              initial[eq.id] = { status: null, meterReading: null, comments: '' };
            }
          }
          this.drafts.set(initial);
          this.isLoadingEquipments.set(false);

          const highlight = this.highlightEquipmentId();
          if (highlight && res.data.some((e) => e.id === highlight)) {
            setTimeout(() => {
              document.getElementById(`avail-eq-${highlight}`)?.scrollIntoView({
                behavior: 'smooth',
                block: 'center',
              });
            }, 100);
          }
        },
        error: () => {
          this.notify.error('No se pudieron cargar los equipos pendientes.');
          this.isLoadingEquipments.set(false);
        },
      });
  }

  openMeterPanel(equipmentId: string): void {
    if (this.expandedMeterIds().has(equipmentId)) return;
    const next = new Set(this.expandedMeterIds());
    next.add(equipmentId);
    this.meterSnapshotService.getSnapshot(equipmentId).subscribe({
      next: (snap) =>
        this.meterSnapshots.update((m) => ({ ...m, [equipmentId]: snap })),
      error: () =>
        this.meterSnapshots.update((m) => ({ ...m, [equipmentId]: null })),
    });
    this.expandedMeterIds.set(next);
  }

  isMeterExpanded(equipmentId: string): boolean {
    return this.expandedMeterIds().has(equipmentId);
  }

  updateDraft(equipmentId: string, patch: Partial<DraftAvailability>): void {
    const current = this.drafts();
    this.drafts.set({
      ...current,
      [equipmentId]: { ...current[equipmentId], ...patch },
    });
  }

  submitAll(): void {
    const ready = this.readyToSubmit();
    if (!ready.length || this.isSubmitting()) return;

    const rows = ready.map(([equipmentId, draft]) => ({
      equipmentId,
      status: draft.status,
      meterReading: draft.meterReading ?? undefined,
      comments: draft.comments.trim() || undefined,
    }));

    this.isSubmitting.set(true);
    this.availabilityService
      .batchCreate(this.reportDate(), this.shift(), rows)
      .subscribe({
        next: (result) => {
          if (result.committed > 0) {
            this.notify.success(
              `${result.committed} equipo${result.committed > 1 ? 's' : ''} reportado${result.committed > 1 ? 's' : ''} correctamente.`,
            );
          }
          if (result.errors.length > 0) {
            this.notify.error(
              `${result.errors.length} equipo(s) con error. Revisa e intenta de nuevo.`,
            );
          }
          this.applyOperationalSideEffects(result.sideEffects);
          this.isSubmitting.set(false);
          this.loadPending();
        },
        error: (err) => {
          const msg: string =
            err?.error?.message ?? 'Error al registrar algunos reportes.';
          this.notify.error(msg);
          this.isSubmitting.set(false);
        },
      });
  }

  confirmLeaveIfDirty(): Observable<boolean> | boolean {
    if (!this.isDirty()) return true;
    this.leaveConfirmOpen.set(true);
    return this.leaveResult$.asObservable();
  }

  onLeaveConfirmed(): void {
    this.leaveConfirmOpen.set(false);
    this.leaveResult$.next(true);
  }

  onLeaveCancelled(): void {
    this.leaveConfirmOpen.set(false);
    this.leaveResult$.next(false);
  }

  private applyOperationalSideEffects(
    sideEffects: AvailabilitySideEffect[] | undefined,
  ): void {
    const faultCompletion = (sideEffects ?? []).find(
      (se) => se.requiresFaultCompletion,
    );
    if (!faultCompletion) return;

    const draft = this.drafts()[faultCompletion.equipmentId];
    this.pendingFaultSideEffect.set(faultCompletion);
    this.pendingFaultSymptom.set(draft?.comments?.trim() || undefined);
    this.pendingFaultMeter.set(
      draft?.meterReading != null ? draft.meterReading : undefined,
    );
    this.faultCompletionConfirmOpen.set(true);
  }

  onFaultCompletionConfirmed(): void {
    const se = this.pendingFaultSideEffect();
    this.faultCompletionConfirmOpen.set(false);
    this.pendingFaultSideEffect.set(null);
    if (!se) return;

    const queryParams: Record<string, string | number> = {
      equipmentId: se.equipmentId,
      from: 'm2',
    };
    const symptom = this.pendingFaultSymptom();
    const meter = this.pendingFaultMeter();
    if (symptom) queryParams['symptom'] = symptom;
    if (meter != null) queryParams['meter'] = meter;

    void this.router.navigate(['/app/operaciones/fallas/nuevo'], { queryParams });
  }

  onFaultCompletionDeclined(): void {
    const se = this.pendingFaultSideEffect();
    this.faultCompletionConfirmOpen.set(false);
    this.pendingFaultSideEffect.set(null);
    if (se) {
      this.availabilityService.markPendingFaultRegistration(se.equipmentId);
    }
  }
}
