import Decimal from 'decimal.js';

/** Tolerancia para comparaciones de saldo (alineado a transferencias W2W). */
export const STOCK_QTY_EPSILON = 1e-9;

export function addStockQty(previousQty: number, delta: number): number {
  return new Decimal(previousQty).plus(delta).toNumber();
}

export function subtractStockQty(
  previousQty: number,
  deductQty: number,
): number {
  return new Decimal(previousQty).minus(deductQty).toNumber();
}

export function isStockQtyNegative(qty: number): boolean {
  return new Decimal(qty).lt(-STOCK_QTY_EPSILON);
}

/** True si descontar `deductQty` dejaría el saldo por debajo de cero. */
export function wouldStockGoNegative(
  previousQty: number,
  deductQty: number,
): boolean {
  return subtractStockQty(previousQty, deductQty) < -STOCK_QTY_EPSILON;
}

/** True si `requested` supera `available` (con epsilon). */
export function exceedsAvailableStock(
  available: number,
  requested: number,
): boolean {
  return new Decimal(available).plus(STOCK_QTY_EPSILON).lt(requested);
}

export function insufficientStockMessage(
  itemLabel: string,
  available: number,
  requested: number,
): string {
  return `Stock insuficiente para ${itemLabel}. Disponible: ${available}, solicitado: ${requested}.`;
}
