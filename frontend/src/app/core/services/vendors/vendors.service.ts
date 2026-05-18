import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../../environments/environment';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface Vendor {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  rut?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  address?: string;
  businessActivity?: string;
  fax?: string;
  city?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Query del listado paginado (`GET /vendors`). */
export interface VendorListQuery {
  search?: string;
  /** Si no se envía, el backend solo devuelve proveedores activos. */
  includeInactive?: boolean;
  page?: number;
  pageSize?: number;
  sort?: string;
  dir?: string;
}

export interface VendorListResponse {
  data: Vendor[];
  total: number;
  page: number;
  pageSize: number;
}

@Injectable({ providedIn: 'root' })
export class VendorsService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/vendors`;

  listVendors(params?: VendorListQuery): Observable<VendorListResponse> {
    const q: Record<string, string> = {};
    const s = params?.search?.trim();
    if (s) q['search'] = s;
    if (params?.includeInactive === true) q['includeInactive'] = 'true';
    if (params?.page != null && params.page > 0) q['page'] = String(params.page);
    if (params?.pageSize != null && params.pageSize > 0) {
      q['pageSize'] = String(params.pageSize);
    }
    if (params?.sort) q['sort'] = params.sort;
    if (params?.dir) q['dir'] = params.dir;
    return this.http.get<VendorListResponse>(this.apiUrl, {
      params: Object.keys(q).length ? q : undefined,
    });
  }

  /**
   * Catálogo para selects (solo activos, hasta 500).
   * Usar en cotizaciones / SRC; no sustituye al listado paginado de maestro.
   */
  getActiveCatalog(): Observable<Vendor[]> {
    return this.listVendors({
      page: 1,
      pageSize: 500,
      sort: 'name',
      dir: 'asc',
    }).pipe(map((res) => res.data));
  }

  getById(id: string): Observable<Vendor> {
    return this.http.get<Vendor>(`${this.apiUrl}/${id}`);
  }

  create(data: Partial<Vendor>): Observable<Vendor> {
    return this.http.post<Vendor>(this.apiUrl, data);
  }

  update(id: string, data: Partial<Vendor>): Observable<Vendor> {
    return this.http.patch<Vendor>(`${this.apiUrl}/${id}`, data);
  }

  remove(id: string): Observable<Vendor> {
    return this.http.delete<Vendor>(`${this.apiUrl}/${id}`);
  }
}
