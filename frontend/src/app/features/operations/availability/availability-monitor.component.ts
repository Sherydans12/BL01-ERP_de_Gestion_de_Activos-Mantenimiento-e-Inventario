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

import { NotificationService } from '../../../core/services/notification/notification.service';
import {
  EquipmentAvailabilityService,
  UnreportedEquipment,
  SHIFTS,
  SHIFT_LABELS,
  ShiftType,
} from '../../../core/services/equipment-availability/equipment-availability.service';
import { O } from '../../../core/constants/operations-permissions';

@Component({
  selector: 'app-availability-monitor',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './availability-monitor.component.html',
})
export class AvailabilityMonitorComponent implements OnInit {
  protected readonly O = O;
  protected readonly SHIFTS = SHIFTS;
  protected readonly SHIFT_LABELS = SHIFT_LABELS;

  private availabilityService = inject(EquipmentAvailabilityService);
  private notify = inject(NotificationService);

  // ── Filtros ───────────────────────────────────────────────────────────────
  filterDate  = signal<string>(this.todayIso());
  filterShift = signal<ShiftType>('DAY');

  // ── Estado ────────────────────────────────────────────────────────────────
  unreported  = signal<UnreportedEquipment[]>([]);
  isLoading   = signal(false);
  lastQueried = signal<string | null>(null);

  /** Badge con el conteo de equipos sin reportar. */
  unreportedCount = computed(() => this.unreported().length);

  /** Estado del panel: vacío = todos reportados; con items = alerta. */
  allReported = computed(() => !this.isLoading() && this.unreportedCount() === 0 && this.lastQueried() != null);

  get maxDate(): string {
    return this.todayIso();
  }

  ngOnInit(): void {
    this.query();
  }

  query(): void {
    this.isLoading.set(true);
    this.availabilityService
      .getUnreported({ date: this.filterDate(), shift: this.filterShift() })
      .subscribe({
        next: (data) => {
          this.unreported.set(data);
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

  onDateChange(v: string): void {
    this.filterDate.set(v);
  }

  onShiftChange(v: ShiftType): void {
    this.filterShift.set(v);
  }

  private todayIso(): string {
    return new Date().toISOString().slice(0, 10);
  }
}
