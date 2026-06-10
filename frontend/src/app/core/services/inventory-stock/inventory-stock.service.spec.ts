import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';

import { InventoryStockService } from './inventory-stock.service';

describe('InventoryStockService', () => {
  let service: InventoryStockService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    service = TestBed.inject(InventoryStockService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
