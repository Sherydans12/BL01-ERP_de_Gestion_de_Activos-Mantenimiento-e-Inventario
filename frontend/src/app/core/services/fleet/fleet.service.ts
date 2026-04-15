import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { Equipment, EquipmentAnalytics } from '../../models/types';

export interface PaginatedEquipments {
  data: Equipment[];
  total: number;
  page: number;
  limit: number;
}

@Injectable({
  providedIn: 'root',
})
export class FleetService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/equipments`;

  /**
   * Lista equipos. Si se pasa `contractId`, se envía `x-contract-id` para filtrar por ese contrato
   * (el interceptor no lo sobrescribe si ya viene fijado).
   */
  getEquipments(
    params?: {
      page?: number;
      limit?: number;
      search?: string;
      type?: string;
      brand?: string;
      /** Alcance por contrato (header `x-contract-id`; no se envía como query). */
      contractId?: string;
    },
    options?: { contractId?: string },
  ): Observable<PaginatedEquipments> {
    let httpParams = new HttpParams();

    if (params) {
      if (params.page) httpParams = httpParams.set('page', String(params.page));
      if (params.limit)
        httpParams = httpParams.set('limit', String(params.limit));
      if (params.search) httpParams = httpParams.set('search', params.search);
      if (params.type) httpParams = httpParams.set('type', params.type);
      if (params.brand) httpParams = httpParams.set('brand', params.brand);
    }

    const contractHeader = options?.contractId ?? params?.contractId;
    let headers = new HttpHeaders();
    if (contractHeader) {
      headers = headers.set('x-contract-id', contractHeader);
    }

    return this.http.get<PaginatedEquipments>(this.apiUrl, {
      params: httpParams,
      headers,
    });
  }

  getEquipmentById(id: string): Observable<Equipment> {
    return this.http.get<Equipment>(`${this.apiUrl}/${id}`);
  }

  getEquipmentAnalytics(id: string): Observable<EquipmentAnalytics> {
    return this.http.get<EquipmentAnalytics>(
      `${this.apiUrl}/${id}/analytics`,
    );
  }

  createEquipment(equipmentData: any): Observable<any> {
    return this.http.post<any>(this.apiUrl, equipmentData);
  }

  updateEquipment(id: string, equipmentData: any): Observable<any> {
    return this.http.put<any>(`${this.apiUrl}/${id}`, equipmentData);
  }

  deleteEquipment(id: string): Observable<any> {
    return this.http.delete<any>(`${this.apiUrl}/${id}`);
  }
}
