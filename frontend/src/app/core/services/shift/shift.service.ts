import { Injectable, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { interval, map, startWith } from 'rxjs';
import type { ShiftType } from '../equipment-availability/equipment-availability.service';
import { TenantService } from '../tenant/tenant.service';

/** Minutos desde medianoche (HH:mm). Partes inválidas → 0. */
export function parseShiftTimeToMinutes(hhmm: string): number {
  const [hRaw, mRaw] = hhmm.split(':');
  const h = parseInt(hRaw ?? '', 10);
  const m = parseInt(mRaw ?? '', 10);
  const hours = Number.isFinite(h) ? h : 0;
  const mins = Number.isFinite(m) ? m : 0;
  return hours * 60 + mins;
}

/** Turno según minutos de reloj y fronteras configuradas (sin política hasNightShift). */
export function resolveClockShift(
  nowMinutes: number,
  dayStartMinutes: number,
  nightStartMinutes: number,
): ShiftType {
  if (dayStartMinutes < nightStartMinutes) {
    return nowMinutes >= dayStartMinutes && nowMinutes < nightStartMinutes
      ? 'DAY'
      : 'NIGHT';
  }
  return nowMinutes >= dayStartMinutes || nowMinutes < nightStartMinutes
    ? 'DAY'
    : 'NIGHT';
}

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

  /** true cuando GET /tenant-config ya hidrató operationalConfig en el tenant. */
  readonly operationalConfigLoaded = computed(
    () => this.tenantService.currentTenant()?.operationalConfig != null,
  );

  readonly hasNightShift = computed(() => {
    const cfg = this.tenantService.currentTenant()?.operationalConfig;
    if (cfg == null) return false;
    return cfg.hasNightShift;
  });

  private readonly _dayStartMinutes = computed(() =>
    parseShiftTimeToMinutes(
      this.tenantService.currentTenant()?.operationalConfig?.dayShiftStartTime ??
        '08:00',
    ),
  );

  private readonly _nightStartMinutes = computed(() =>
    parseShiftTimeToMinutes(
      this.tenantService.currentTenant()?.operationalConfig?.nightShiftStartTime ??
        '20:00',
    ),
  );

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

    const now = this._now();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    return resolveClockShift(
      nowMinutes,
      this._dayStartMinutes(),
      this._nightStartMinutes(),
    );
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

  /**
   * Tras cargar la config del tenant: alinea al turno del reloj salvo que la URL
   * fijara ?shift= explícitamente.
   */
  alignShiftAfterConfigLoad(
    current: ShiftType,
    pinnedByUrl: boolean,
  ): ShiftType {
    if (pinnedByUrl) return this.coerceShift(current);
    return this.coerceShift(this.currentShift());
  }

  /** Turnos mostrables en selectores (historial, import, etc.). */
  readonly selectableShifts = computed((): ShiftType[] =>
    this.hasNightShift() ? ['DAY', 'NIGHT'] : ['DAY'],
  );
}
