import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';

import { InventoryItemsService } from './inventory-items.service';

describe('InventoryItemsService', () => {
  let service: InventoryItemsService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    service = TestBed.inject(InventoryItemsService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
