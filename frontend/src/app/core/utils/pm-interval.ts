import { Equipment, MeterType } from '../models/types';

/** Origen del intervalo PM para UI y reglas de negocio. */
export type PmIntervalSource =
  | 'override'
  | 'fleet_frequency'
  | 'heuristic_default';

export interface ResolvedPmInterval {
  value: number;
  source: PmIntervalSource;
}

/** Heurística solo si no hay dato operativo en flota (override ni frecuencia). */
export function intervalFromHeuristic(equipment: Equipment): number {
  const t = `${equipment.type || ''} ${equipment.model || ''}`.toLowerCase();

  if (t.includes('camioneta') || t.includes('suv') || t.includes('pickup')) {
    return equipment.meterType === MeterType.KILOMETERS ? 10000 : 250;
  }
  if (
    t.includes('carretera') ||
    t.includes('tracto') ||
    t.includes('alto tonelaje')
  ) {
    return 600;
  }
  if (t.includes('camión') || t.includes('camion') || t.includes('dumper')) {
    return 500;
  }

  return 250;
}

/**
 * Prioridad: `pmIntervalOverride` → `maintenanceFrequency` (maestro flota) → heurística por tipo/modelo.
 */
export function resolvePmInterval(equipment: Equipment): ResolvedPmInterval {
  const o = equipment.pmIntervalOverride;
  if (o != null && o > 0) {
    return { value: o, source: 'override' };
  }
  const f = equipment.maintenanceFrequency;
  if (f != null && f > 0) {
    return { value: f, source: 'fleet_frequency' };
  }
  return {
    value: intervalFromHeuristic(equipment),
    source: 'heuristic_default',
  };
}

/** Compatibilidad: un solo número para lógicas que no necesitan la fuente. */
export function defaultPmInterval(equipment: Equipment): number {
  return resolvePmInterval(equipment).value;
}

export function pmIntervalSourceLabel(source: PmIntervalSource): string {
  switch (source) {
    case 'override':
      return 'Override ERP';
    case 'fleet_frequency':
      return 'Frecuencia en maestro de flota';
    case 'heuristic_default':
      return 'Regla por tipo/modelo (predeterminado)';
    default:
      return source;
  }
}

export interface PmProjection {
  interval: number;
  source: PmIntervalSource;
  /** Próximo mantenimiento estimado en unidades de medidor */
  nextDueMeter: number | null;
  /** Unidades restantes hasta la próxima mantención */
  remainingUnits: number | null;
}

export function computePmProjection(
  equipment: Equipment | null,
): PmProjection | null {
  if (!equipment) return null;
  const { value: interval, source } = resolvePmInterval(equipment);
  const base =
    equipment.lastMaintenanceMeter != null
      ? equipment.lastMaintenanceMeter
      : equipment.initialMeter ?? 0;
  const current = equipment.currentMeter ?? base;
  const nextDueMeter = base + interval;
  const remainingUnits = Math.max(0, nextDueMeter - current);
  return { interval, source, nextDueMeter, remainingUnits };
}
