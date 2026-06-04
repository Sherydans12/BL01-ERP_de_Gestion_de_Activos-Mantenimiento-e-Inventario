import { BadRequestException } from '@nestjs/common';

/** Umbral por defecto para fluidos en litros (consumo atípico en terreno). */
export const DEFAULT_LARGE_FLUID_DISPATCH_LT = 100;

export function largeFluidDispatchThreshold(
  unitAbbr: string,
  allowsDecimals: boolean,
): number {
  if (!allowsDecimals) return 50;
  const u = (unitAbbr || '').trim().toUpperCase();
  if (u === 'KG') return 80;
  if (u === 'LT' || u === 'LTS' || u === 'L') return DEFAULT_LARGE_FLUID_DISPATCH_LT;
  return DEFAULT_LARGE_FLUID_DISPATCH_LT;
}

export function requiresLargeDispatchConfirmation(
  quantity: number,
  unitAbbr: string,
  allowsDecimals: boolean,
): boolean {
  if (!Number.isFinite(quantity) || quantity <= 0) return false;
  return quantity > largeFluidDispatchThreshold(unitAbbr, allowsDecimals);
}

export function assertQuantityAllowedForUom(
  quantity: number,
  allowsDecimals: boolean,
  itemLabel: string,
  unitAbbr: string,
): void {
  if (!allowsDecimals && !Number.isInteger(quantity)) {
    throw new BadRequestException(
      `El artículo "${itemLabel}" usa unidad "${unitAbbr}" que no admite fracciones. La cantidad debe ser un número entero.`,
    );
  }
}

export function assertLargeDispatchConfirmed(
  quantity: number,
  unitAbbr: string,
  allowsDecimals: boolean,
  confirmedLargeDispatch: boolean | undefined,
  itemLabel: string,
): void {
  if (
    requiresLargeDispatchConfirmation(quantity, unitAbbr, allowsDecimals) &&
    confirmedLargeDispatch !== true
  ) {
    const threshold = largeFluidDispatchThreshold(unitAbbr, allowsDecimals);
    throw new BadRequestException(
      `La cantidad de "${itemLabel}" (${quantity} ${unitAbbr}) supera el umbral operativo (${threshold}). Confirme con confirmedLargeDispatch.`,
    );
  }
}
