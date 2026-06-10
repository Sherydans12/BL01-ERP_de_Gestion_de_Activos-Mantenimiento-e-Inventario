import type {
  EquipmentMeterSnapshot,
  MeterCaptureBoardRow,
  MeterLogSource,
} from '../../core/models/types';
import { MeterType } from '../../core/models/types';

export interface MeterReferenceView {
  readingValue: number;
  meterType: MeterType;
  unitLabel: string;
  hasPriorLog: boolean;
  dateIso: string | null;
  source: MeterLogSource | null;
  otCorrelative: string | null;
}

export function meterUnitLabel(meterType: MeterType): string {
  return meterType === MeterType.KILOMETERS ? 'Km' : 'Hrs';
}

/** Resuelve la vista del banner desde snapshot, fila de board o tipo explícito. */
export function resolveMeterReferenceView(
  snapshot: EquipmentMeterSnapshot | null | undefined,
  boardRow: MeterCaptureBoardRow | null | undefined,
  meterTypeOverride: MeterType | null | undefined,
): MeterReferenceView | null {
  if (snapshot) {
    const meterType = snapshot.meterType;
    const last = snapshot.lastLog;
    return {
      readingValue: snapshot.currentMeter,
      meterType,
      unitLabel: meterUnitLabel(meterType),
      hasPriorLog: !!last,
      dateIso: last?.date ?? null,
      source: last?.source ?? null,
      otCorrelative: last?.otCorrelative ?? null,
    };
  }

  if (boardRow) {
    return {
      readingValue: boardRow.currentMeter,
      meterType: boardRow.meterType,
      unitLabel: meterUnitLabel(boardRow.meterType),
      hasPriorLog: !!boardRow.lastReadingAt,
      dateIso: boardRow.lastReadingAt,
      source: boardRow.lastReadingSource ?? null,
      otCorrelative: null,
    };
  }

  if (meterTypeOverride) {
    return {
      readingValue: 0,
      meterType: meterTypeOverride,
      unitLabel: meterUnitLabel(meterTypeOverride),
      hasPriorLog: false,
      dateIso: null,
      source: null,
      otCorrelative: null,
    };
  }

  return null;
}
