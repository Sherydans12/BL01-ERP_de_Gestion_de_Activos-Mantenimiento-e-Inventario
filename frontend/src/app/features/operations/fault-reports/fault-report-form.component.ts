import {
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule, NgClass } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Observable, Subject } from 'rxjs';

import { NotificationService } from '../../../core/services/notification/notification.service';
import { FleetService } from '../../../core/services/fleet/fleet.service';
import {
  FaultReportsService,
  CreateFaultReportPayload,
  AffectedSystem,
  FaultCriticality,
  AFFECTED_SYSTEMS,
  FAULT_CRITICALITIES,
  SYSTEM_LABELS,
  CRITICALITY_META,
} from '../../../core/services/fault-reports/fault-reports.service';
import { ConfirmModalComponent } from '../../../shared/components/confirm-modal/confirm-modal.component';

@Component({
  selector: 'app-fault-report-form',
  standalone: true,
  imports: [CommonModule, NgClass, FormsModule, RouterLink, ConfirmModalComponent],
  templateUrl: './fault-report-form.component.html',
})
export class FaultReportFormComponent implements OnInit {
  protected readonly AFFECTED_SYSTEMS   = AFFECTED_SYSTEMS;
  protected readonly FAULT_CRITICALITIES = FAULT_CRITICALITIES;
  protected readonly SYSTEM_LABELS      = SYSTEM_LABELS;
  protected readonly CRITICALITY_META   = CRITICALITY_META;

  private faultService = inject(FaultReportsService);
  private fleetService = inject(FleetService);
  private notify       = inject(NotificationService);

  // ── Catálogo de equipos ───────────────────────────────────────────────────
  equipments   = signal<any[]>([]);
  equipSearch  = signal('');
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
  selectedEquipmentId  = signal<string>('');
  eventDate            = signal<string>(this.nowIso());
  meterAtFault         = signal<number | null>(null);
  selectedSystem       = signal<AffectedSystem | ''>('');
  selectedCriticality  = signal<FaultCriticality | ''>('');
  symptomDescription   = signal<string>('');

  isSubmitting = signal(false);

  selectedEquipmentLabel = computed(() => {
    const eq = this.equipments().find((e) => e.id === this.selectedEquipmentId());
    if (!eq) return '';
    const plate = eq.plate ? ` — ${eq.plate}` : '';
    return `${eq.internalId ?? ''} ${eq.brand ?? ''} ${eq.model ?? ''}${plate}`.trim();
  });

  isFormValid = computed(
    () =>
      !!this.selectedEquipmentId() &&
      !!this.eventDate() &&
      !!this.selectedSystem() &&
      !!this.selectedCriticality() &&
      this.symptomDescription().trim().length >= 10,
  );

  isDirty = computed(
    () =>
      !!this.selectedEquipmentId() ||
      !!this.selectedSystem() ||
      !!this.selectedCriticality() ||
      this.symptomDescription().trim().length > 0,
  );

  // ── CanDeactivate ─────────────────────────────────────────────────────────
  leaveConfirmOpen = signal(false);
  private leaveResult$ = new Subject<boolean>();

  get maxDate(): string {
    return new Date().toISOString().slice(0, 16); // datetime-local max
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

    const payload: CreateFaultReportPayload = {
      equipmentId:        this.selectedEquipmentId(),
      eventDate:          this.eventDate(),
      affectedSystem:     this.selectedSystem() as AffectedSystem,
      criticality:        this.selectedCriticality() as FaultCriticality,
      symptomDescription: this.symptomDescription().trim(),
      ...(this.meterAtFault() != null ? { meterAtFault: this.meterAtFault()! } : {}),
    };

    this.isSubmitting.set(true);
    this.faultService.create(payload).subscribe({
      next: (report) => {
        const criticality = this.selectedCriticality() as FaultCriticality;
        const woMsg = (criticality === 'HIGH' || criticality === 'MEDIUM')
          ? ' Se generó automáticamente una OT correctiva.'
          : '';
        this.notify.success(`Falla ${report.correlative} registrada.${woMsg}`);
        this.resetForm();
        this.isSubmitting.set(false);
      },
      error: (err) => {
        const msg: string = err?.error?.message ?? 'Ocurrió un error al registrar la falla.';
        this.notify.error(msg);
        this.isSubmitting.set(false);
      },
    });
  }

  resetForm(): void {
    this.selectedEquipmentId.set('');
    this.equipSearch.set('');
    this.eventDate.set(this.nowIso());
    this.meterAtFault.set(null);
    this.selectedSystem.set('');
    this.selectedCriticality.set('');
    this.symptomDescription.set('');
  }

  private nowIso(): string {
    // datetime-local requiere formato YYYY-MM-DDTHH:mm
    const d = new Date();
    return d.toISOString().slice(0, 16);
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
