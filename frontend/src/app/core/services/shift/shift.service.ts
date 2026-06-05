import { Injectable, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { interval, map, startWith } from 'rxjs';
import type { ShiftType } from '../equipment-availability/equipment-availability.service';
import { TenantService } from '../tenant/tenant.service';

/**
 * Turno operativo activo derivado de la hora local y la configuración del tenant.
 *
 * Los horarios de inicio (dayShiftStartTime / nightShiftStartTime) se leen de
 * TenantService.currentTenant().operationalConfig, que se carga al login y al
 * inicializar el layout (GET /tenant-config).
 *
 * Regla inquebrantable: si hasNightShift === false, currentShift() devuelve
 * siempre 'DAY' sin importar la hora del reloj.
 *
 * Mientras operationalConfig no está cargado, hasNightShift se trata como false
 * para no enviar NIGHT al backend antes de conocer la política del tenant.
 */
@Injectable({ providedIn: 'root' })
export class ShiftService {
  private readonly tenantService = inject(TenantService);

  // Tick cada minuto para mantener reloj y turno al día.
  private readonly _now = toSignal(
    interval(60_000).pipe(
      startWith(0),
      map(() => new Date()),
    ),
    { initialValue: new Date() },
  );

  readonly now = computed(() => this._now());

  // ── Configuración operativa leída del tenant (con defaults seguros) ────────

  readonly hasNightShift = computed(() => {
    const cfg = this.tenantService.currentTenant()?.operationalConfig;
    if (cfg == null) return false;
    return cfg.hasNightShift;
  });

  private readonly _dayStartHour = computed(() => {
    const time =
      this.tenantService.currentTenant()?.operationalConfig?.dayShiftStartTime ?? '08:00';
    return parseInt(time.split(':')[0], 10);
  });

  private readonly _nightStartHour = computed(() => {
    const time =
      this.tenantService.currentTenant()?.operationalConfig?.nightShiftStartTime ?? '20:00';
    return parseInt(time.split(':')[0], 10);
  });

  private readonly _dayStartTime = computed(
    () =>
      this.tenantService.currentTenant()?.operationalConfig?.dayShiftStartTime ?? '08:00',
  );

  private readonly _nightStartTime = computed(
    () =>
      this.tenantService.currentTenant()?.operationalConfig?.nightShiftStartTime ?? '20:00',
  );

  // ── Señales públicas ───────────────────────────────────────────────────────

  readonly currentShift = computed((): ShiftType => {
    if (!this.hasNightShift()) return 'DAY';

    const h = this._now().getHours();
    const dayH = this._dayStartHour();
    const nightH = this._nightStartHour();

    if (dayH < nightH) {
      return h >= dayH && h < nightH ? 'DAY' : 'NIGHT';
    }
    return h >= dayH || h < nightH ? 'DAY' : 'NIGHT';
  });

  readonly shiftLabel = computed(() =>
    this.currentShift() === 'DAY' ? 'Turno Día' : 'Turno Noche',
  );

  readonly shiftHours = computed(() => {
    if (!this.hasNightShift()) {
      return `Desde ${this._dayStartTime()}`;
    }
    return this.currentShift() === 'DAY'
      ? `${this._dayStartTime()}–${this._nightStartTime()}`
      : `${this._nightStartTime()}–${this._dayStartTime()}`;
  });

  /** Fecha local (YYYY-MM-DD) para consultar reportes del turno actual. */
  readonly todayIso = computed(() => {
    const d = this._now();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  });

  /**
   * Normaliza un turno para APIs y filtros: NIGHT → DAY si el tenant no opera noche.
   * Sin valor explícito usa el turno vigente según reloj y configuración.
   */
  coerceShift(shift?: ShiftType | string | null): ShiftType {
    const candidate: ShiftType =
      shift === 'NIGHT' || shift === 'DAY' ? shift : this.currentShift();
    if (candidate === 'NIGHT' && !this.hasNightShift()) return 'DAY';
    return candidate;
  }

  /** Turnos mostrables en selectores (historial, import, etc.). */
  readonly selectableShifts = computed((): ShiftType[] =>
    this.hasNightShift() ? ['DAY', 'NIGHT'] : ['DAY'],
  );
}
