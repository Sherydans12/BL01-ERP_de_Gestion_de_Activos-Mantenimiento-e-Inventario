/** Duplicado alineado con frontend `pm-interval.ts` para proyección server-side. */

export type MeterTypeBackend = 'HOURS' | 'KILOMETERS';

export type PmIntervalSource =
  | 'override'
  | 'fleet_frequency'
  | 'heuristic_default';

export interface EquipmentPmInput {
  type: string;
  model: string;
  meterType: MeterTypeBackend;
  initialMeter: number;
  currentMeter: number;
  maintenanceFrequency: number | null;
  pmIntervalOverride: number | null;
  lastMaintenanceMeter: number | null;
}

function intervalFromHeuristic(equipment: EquipmentPmInput): number {
  const t = `${equipment.type || ''} ${equipment.model || ''}`.toLowerCase();
  if (t.includes('camioneta') || t.includes('suv') || t.includes('pickup')) {
    return equipment.meterType === 'KILOMETERS' ? 10000 : 250;
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

export function resolvePmInterval(equipment: EquipmentPmInput): {
  value: number;
  source: PmIntervalSource;
} {
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

export function pmIntervalSourceLabel(source: PmIntervalSource): string {
  switch (source) {
    case 'override':
      return 'Override ERP';
    case 'fleet_frequency':
      return 'Frecuencia en maestro de flota';
    case 'heuristic_default':
      return 'Heurística tipo/modelo';
    default:
      return source;
  }
}

export function computePmProjection(equipment: EquipmentPmInput): {
  interval: number;
  source: PmIntervalSource;
  nextDueMeter: number;
  remainingUnits: number;
} {
  const { value: interval, source } = resolvePmInterval(equipment);
  const base =
    equipment.lastMaintenanceMeter != null
      ? equipment.lastMaintenanceMeter
      : (equipment.initialMeter ?? 0);
  const current = equipment.currentMeter ?? base;
  const nextDueMeter = base + interval;
  const remainingUnits = Math.max(0, nextDueMeter - current);
  return { interval, source, nextDueMeter, remainingUnits };
}
