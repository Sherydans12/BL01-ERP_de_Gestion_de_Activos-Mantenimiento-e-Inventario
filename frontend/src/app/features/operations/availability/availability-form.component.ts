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
import { Observable, Subject } from 'rxjs';

import { NotificationService } from '../../../core/services/notification/notification.service';
import { FleetService } from '../../../core/services/fleet/fleet.service';
import {
  EquipmentAvailabilityService,
  CreateAvailabilityPayload,
  SHIFTS,
  OPERATIONAL_STATUSES,
  SHIFT_LABELS,
  STATUS_LABELS,
  ShiftType,
  OperationalStatus,
} from '../../../core/services/equipment-availability/equipment-availability.service';
import { ConfirmModalComponent } from '../../../shared/components/confirm-modal/confirm-modal.component';
import { O } from '../../../core/constants/operations-permissions';

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

  private availabilityService = inject(EquipmentAvailabilityService);
  private fleetService = inject(FleetService);
  private notify = inject(NotificationService);

  // ── Catálogo ─────────────────────────────────────────────────────────────
  equipments  = signal<any[]>([]);
  equipSearch = signal('');
  equipLoading = signal(true);

  filteredEquipments = computed(() => {
    const q = this.equipSearch().toLowerCase().trim();
    if (!q) return this.equipments();
    return this.equipments().filter(
      (e) =>
        e.internalId?.toLowerCase().includes(q) ||
        e.brand?.toLowerCase().includes(q) ||
        e.model?.toLowerCase().includes(q) ||
        (e.plate ?? '').toLowerCase().includes(q),
    );
  });

  // ── Estado del formulario ─────────────────────────────────────────────────
  reportDate     = signal<string>(this.todayIso());
  shift          = signal<ShiftType>('DAY');
  selectedEquipmentId = signal<string>('');
  status         = signal<OperationalStatus>('OPERATIONAL');
  meterReading   = signal<number | null>(null);
  comments       = signal<string>('');

  isSubmitting = signal(false);

  /** Etiqueta del equipo seleccionado para mostrar en el campo. */
  selectedEquipmentLabel = computed(() => {
    const eq = this.equipments().find((e) => e.id === this.selectedEquipmentId());
    if (!eq) return '';
    const plate = eq.plate ? ` — ${eq.plate}` : '';
    return `${eq.internalId ?? ''} ${eq.brand ?? ''} ${eq.model ?? ''}${plate}`.trim();
  });

  /** El formulario es válido cuando tiene equipo, fecha, turno y estado. */
  isFormValid = computed(
    () => !!this.selectedEquipmentId() && !!this.reportDate() && !!this.shift() && !!this.status(),
  );

  /** Indica si el formulario tiene datos sin guardar (dirty). */
  isDirty = computed(
    () =>
      !!this.selectedEquipmentId() ||
      this.meterReading() != null ||
      !!this.comments().trim(),
  );

  // ── CanDeactivate ─────────────────────────────────────────────────────────
  leaveConfirmOpen = signal(false);
  private leaveResult$ = new Subject<boolean>();

  // ── Fecha máxima ──────────────────────────────────────────────────────────
  get maxDate(): string {
    return this.todayIso();
  }

  ngOnInit(): void {
    this.fleetService.getEquipments({ limit: 300 }).subscribe({
      next: (res) => {
        this.equipments.set(res.data ?? res);
        this.equipLoading.set(false);
      },
      error: () => {
        this.notify.error('No se pudieron cargar los equipos.');
        this.equipLoading.set(false);
      },
    });
  }

  onSelectEquipment(id: string): void {
    this.selectedEquipmentId.set(id);
    this.equipSearch.set('');
  }

  submit(): void {
    if (!this.isFormValid() || this.isSubmitting()) return;

    const payload: CreateAvailabilityPayload = {
      equipmentId: this.selectedEquipmentId(),
      reportDate: this.reportDate(),
      shift: this.shift(),
      status: this.status(),
      meterReading: this.meterReading() ?? undefined,
      comments: this.comments().trim() || undefined,
    };

    this.isSubmitting.set(true);
    this.availabilityService.create(payload).subscribe({
      next: () => {
        this.notify.success('Reporte de disponibilidad registrado correctamente.');
        this.resetForm();
        this.isSubmitting.set(false);
      },
      error: (err) => {
        const msg: string =
          err?.error?.message ?? 'Ocurrió un error al registrar el reporte.';
        this.notify.error(msg);
        this.isSubmitting.set(false);
      },
    });
  }

  resetForm(): void {
    this.selectedEquipmentId.set('');
    this.equipSearch.set('');
    this.reportDate.set(this.todayIso());
    this.shift.set('DAY');
    this.status.set('OPERATIONAL');
    this.meterReading.set(null);
    this.comments.set('');
  }

  private todayIso(): string {
    return new Date().toISOString().slice(0, 10);
  }

  // ── CanDeactivate logic ───────────────────────────────────────────────────

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
