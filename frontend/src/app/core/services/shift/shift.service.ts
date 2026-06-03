import { Injectable, computed } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { interval, map, startWith } from 'rxjs';
import type { ShiftType } from '../equipment-availability/equipment-availability.service';

/**
 * Turno operativo activo derivado de la hora local.
 *
 * Regla provisional (sin módulo de configuración aún): DÍA = 08:00–20:00,
 * NOCHE = 20:00–08:00. Si en el futuro se requiere configurar manualmente
 * los rangos por faena, este servicio es el único punto a tocar.
 */
@Injectable({ providedIn: 'root' })
export class ShiftService {
  // Tick cada minuto para que el turno y el reloj del header se mantengan al día.
  private readonly _now = toSignal(
    interval(60_000).pipe(
      startWith(0),
      map(() => new Date()),
    ),
    { initialValue: new Date() },
  );

  readonly now = computed(() => this._now());

  readonly currentShift = computed((): ShiftType => {
    const h = this._now().getHours();
    return h >= 8 && h < 20 ? 'DAY' : 'NIGHT';
  });

  readonly shiftLabel = computed(() =>
    this.currentShift() === 'DAY' ? 'Turno Día' : 'Turno Noche',
  );

  readonly shiftHours = computed(() =>
    this.currentShift() === 'DAY' ? '08:00–20:00' : '20:00–08:00',
  );

  /** Fecha local (YYYY-MM-DD) para consultar reportes del turno actual. */
  readonly todayIso = computed(() => {
    const d = this._now();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  });
}
