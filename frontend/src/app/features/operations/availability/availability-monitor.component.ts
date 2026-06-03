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
import { ShiftService } from '../../../core/services/shift/shift.service';
import { FleetService } from '../../../core/services/fleet/fleet.service';
import { DeviceService } from '../../../core/services/device/device.service';
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
  private fleetService = inject(FleetService);
  private notify = inject(NotificationService);
  protected readonly deviceService = inject(DeviceService);
  protected readonly shiftService = inject(ShiftService);

  // ── Filtros ───────────────────────────────────────────────────────────────
  filterDate  = signal<string>(this.todayIso());
  filterShift = signal<ShiftType>('DAY');

  // ── Estado ────────────────────────────────────────────────────────────────
  unreported  = signal<UnreportedEquipment[]>([]);
  isLoading   = signal(false);
  lastQueried = signal<string | null>(null);

  /** Total de equipos de la flota (desde FleetService). */
  totalFleet = signal(0);

  /** Equipos sin reportar en el turno consultado. */
  unreportedCount = computed(() => this.unreported().length);

  /** Derivado: reportados = total - pendientes (solo válido tras la consulta). */
  reportedCount = computed(() =>
    Math.max(0, this.totalFleet() - this.unreportedCount()),
  );

  /** Todos reportados: sin cargando, lista vacía, con consulta previa. */
  allReported = computed(
    () => !this.isLoading() && this.unreportedCount() === 0 && this.lastQueried() != null,
  );

  get maxDate(): string {
    return this.todayIso();
  }

  ngOnInit(): void {
    this.fleetService.getEquipments({ limit: 1 }).subscribe({
      next: (res) => this.totalFleet.set(res.total),
      error: () => { /* no crítico: el summary bar simplemente no muestra total */ },
    });
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
