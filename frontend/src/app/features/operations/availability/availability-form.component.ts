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
import { Observable, Subject, forkJoin } from 'rxjs';

import { NotificationService } from '../../../core/services/notification/notification.service';
import {
  EquipmentAvailabilityService,
  CreateAvailabilityPayload,
  SHIFTS,
  OPERATIONAL_STATUSES,
  SHIFT_LABELS,
  STATUS_LABELS,
  ShiftType,
  OperationalStatus,
  UnreportedEquipment,
} from '../../../core/services/equipment-availability/equipment-availability.service';
import { ConfirmModalComponent } from '../../../shared/components/confirm-modal/confirm-modal.component';
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

@Component({
  selector: 'app-availability-form',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, ConfirmModalComponent],
  templateUrl: './availability-form.component.html',
})
export class AvailabilityFormComponent implements OnInit {
  protected readonly O = O;
  protected readonly SHIFTS = SHIFTS;
  protected readonly OPERATIONAL_STATUSES = OPERATIONAL_STATUSES;
  protected readonly SHIFT_LABELS = SHIFT_LABELS;
  protected readonly STATUS_LABELS = STATUS_LABELS;
  protected readonly STATUS_DOT = STATUS_DOT;

  private availabilityService = inject(EquipmentAvailabilityService);
  private notify = inject(NotificationService);

  // ── Filtros de turno ──────────────────────────────────────────────────────
  reportDate = signal<string>(this.todayIso());
  shift = signal<ShiftType>('DAY');

  // ── Lista de equipos pendientes ───────────────────────────────────────────
  pendingEquipments = signal<UnreportedEquipment[]>([]);
  isLoadingEquipments = signal(false);

  // ── Estado bulk: Record<equipmentId, DraftAvailability> ──────────────────
  drafts = signal<Record<string, DraftAvailability>>({});

  // ── Envío ─────────────────────────────────────────────────────────────────
  isSubmitting = signal(false);

  /** Entradas listas = tienen al menos el status seleccionado. */
  readyToSubmit = computed(() =>
    Object.entries(this.drafts()).filter(
      ([, v]) => v.status !== null,
    ) as [string, DraftAvailability & { status: OperationalStatus }][],
  );

  readyCount = computed(() => this.readyToSubmit().length);

  /** Hay datos sin guardar si algún draft fue tocado. */
  isDirty = computed(() =>
    Object.values(this.drafts()).some(
      (v) => v.status !== null || v.meterReading != null || !!v.comments.trim(),
    ),
  );

  // ── CanDeactivate ─────────────────────────────────────────────────────────
  leaveConfirmOpen = signal(false);
  private leaveResult$ = new Subject<boolean>();

  get maxDate(): string {
    return this.todayIso();
  }

  ngOnInit(): void {
    this.loadPending();
  }

  loadPending(): void {
    this.isLoadingEquipments.set(true);
    this.availabilityService
      .getUnreported({ date: this.reportDate(), shift: this.shift() })
      .subscribe({
        next: (list) => {
          this.pendingEquipments.set(list);
          const initial: Record<string, DraftAvailability> = {};
          for (const eq of list) {
            initial[eq.id] = { status: null, meterReading: null, comments: '' };
          }
          this.drafts.set(initial);
          this.isLoadingEquipments.set(false);
        },
        error: () => {
          this.notify.error('No se pudieron cargar los equipos pendientes.');
          this.isLoadingEquipments.set(false);
        },
      });
  }

  onFilterChange(): void {
    this.loadPending();
  }

  /**
   * Actualiza un campo del borrador de un equipo de forma inmutable.
   * Signal<Record<>> → nuevo objeto raíz → Angular detecta el cambio.
   */
  updateDraft(equipmentId: string, patch: Partial<DraftAvailability>): void {
    const current = this.drafts();
    this.drafts.set({
      ...current,
      [equipmentId]: { ...current[equipmentId], ...patch },
    });
  }

  /**
   * Envía todos los reportes listos (status != null) en paralelo con forkJoin.
   * Muestra un solo toast de resultado al finalizar.
   */
  submitAll(): void {
    const ready = this.readyToSubmit();
    if (!ready.length || this.isSubmitting()) return;

    const requests = ready.map(([equipmentId, draft]) =>
      this.availabilityService.create({
        equipmentId,
        reportDate: this.reportDate(),
        shift: this.shift(),
        status: draft.status,
        meterReading: draft.meterReading ?? undefined,
        comments: draft.comments.trim() || undefined,
      } as CreateAvailabilityPayload),
    );

    this.isSubmitting.set(true);
    forkJoin(requests).subscribe({
      next: () => {
        const n = ready.length;
        this.notify.success(
          `${n} equipo${n > 1 ? 's' : ''} reportado${n > 1 ? 's' : ''} correctamente.`,
        );
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

  private todayIso(): string {
    return new Date().toISOString().slice(0, 10);
  }

  // ── CanDeactivate ─────────────────────────────────────────────────────────

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
}
