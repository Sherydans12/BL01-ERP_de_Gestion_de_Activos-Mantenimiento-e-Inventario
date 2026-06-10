import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';

import { WarehousesService } from './warehouses.service';

describe('WarehousesService', () => {
  let service: WarehousesService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    service = TestBed.inject(WarehousesService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
