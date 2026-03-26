import { TestBed } from '@angular/core/testing';

import { InventoryStockService } from './inventory-stock.service';

describe('InventoryStockService', () => {
  let service: InventoryStockService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(InventoryStockService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
