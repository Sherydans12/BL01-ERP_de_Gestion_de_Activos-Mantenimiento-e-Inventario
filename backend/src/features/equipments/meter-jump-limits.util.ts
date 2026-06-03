import { MeterType } from '@prisma/client';

/** Umbral de salto atípico por lectura masiva (fin de turno). */
export function getMeterJumpLimit(meterType: MeterType): number {
  switch (meterType) {
    case MeterType.KILOMETERS:
      return 500;
    case MeterType.HOURS:
    default:
      return 24;
  }
}
