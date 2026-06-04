import {
  subtractStockQty,
  wouldStockGoNegative,
  exceedsAvailableStock,
} from './stock-quantity.util';

describe('stock-quantity.util', () => {
  it('subtractStockQty mantiene precisión decimal en restas típicas', () => {
    expect(subtractStockQty(10, 3.3)).toBe(6.7);
    expect(subtractStockQty(100, 0.1)).toBe(99.9);
  });

  it('wouldStockGoNegative detecta déficit con epsilon', () => {
    expect(wouldStockGoNegative(10, 10.1)).toBe(true);
    expect(wouldStockGoNegative(10, 9.9)).toBe(false);
  });

  it('exceedsAvailableStock alinea con transferencias W2W', () => {
    expect(exceedsAvailableStock(5, 5.1)).toBe(true);
    expect(exceedsAvailableStock(5, 4.9)).toBe(false);
  });
});
