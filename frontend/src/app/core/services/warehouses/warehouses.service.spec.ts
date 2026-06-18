import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';

import { WarehousesService } from './warehouses.service';
import { environment } from '../../../../environments/environment';

describe('WarehousesService', () => {
  let service: WarehousesService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    service = TestBed.inject(WarehousesService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('carga bodegas para W2W con scope transfer', () => {
    service.getWarehousesForTransfer().subscribe((rows) => {
      expect(rows).toEqual([{ id: 'wh-a' } as any]);
    });

    const req = httpMock.expectOne(
      `${environment.apiUrl}/warehouses?scope=transfer`,
    );
    expect(req.request.method).toBe('GET');
    req.flush([{ id: 'wh-a' }]);
  });
});
