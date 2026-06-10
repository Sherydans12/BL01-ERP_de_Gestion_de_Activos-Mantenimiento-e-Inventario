import type { MeterLogSource } from '../../core/models/types';

export interface MeterSourceLabelOptions {
  otCorrelative?: string | null;
}

/**
 * Etiqueta legible para badges de fuente de lectura (banner, OT, historial).
 */
export function getMeterSourceLabel(
  source: MeterLogSource,
  options?: MeterSourceLabelOptions,
): string {
  switch (source) {
    case 'OT':
      return options?.otCorrelative
        ? `OT ${options.otCorrelative}`
        : 'Orden de trabajo';
    case 'MANUAL':
      return 'Manual / captura';
    case 'TELEMETRY':
      return 'Telemetría';
    case 'AVAILABILITY_REPORT':
      return 'Disponibilidad (M2)';
    case 'FAULT_REPORT':
      return 'Falla (M3)';
    default:
      return source;
  }
}
