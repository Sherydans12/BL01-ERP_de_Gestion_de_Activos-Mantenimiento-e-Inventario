/** Umbral por defecto para fluidos en litros (consumo atípico). */
export const DEFAULT_LARGE_FLUID_DISPATCH_LT = 100;

const STOCK_QTY_EPSILON = 1e-9;

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

export function exceedsAvailableStock(
  available: number,
  requested: number,
): boolean {
  return available + STOCK_QTY_EPSILON < requested;
}

export function parseFluidQuantity(
  raw: string | number | null | undefined,
  allowsDecimals: boolean,
): number {
  if (raw === null || raw === undefined || raw === '') return 0;
  const n =
    typeof raw === 'number'
      ? raw
      : parseFloat(String(raw).replace(',', '.'));
  if (!Number.isFinite(n)) return 0;
  return allowsDecimals ? n : Math.floor(n);
}

export function hasInvalidDecimalQuantity(
  quantity: number,
  allowsDecimals: boolean,
): boolean {
  return quantity > 0 && !allowsDecimals && !Number.isInteger(quantity);
}
