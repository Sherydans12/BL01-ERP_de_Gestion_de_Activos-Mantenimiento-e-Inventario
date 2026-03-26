import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

export interface CreateWorkOrderPayload {
  equipmentId: string;
  type: string;
  category: string;
  maintenanceType: string;
  initialHorometer: number;
  finalHorometer: number;
  description: string;
  systems: string[];
  fluids: { fluidId: string; liters: number; action: string }[];
}

@Injectable({
  providedIn: 'root',
})
export class WorkOrdersService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/work-orders`;

  createOT(payload: CreateWorkOrderPayload): Observable<any> {
    return this.http.post(this.apiUrl, payload);
  }

  getWorkOrders(): Observable<any[]> {
    return this.http.get<any[]>(this.apiUrl);
  }

  getWorkOrdersFiltered(params: {
    page?: number;
    limit?: number;
    search?: string;
    status?: string;
    dateFrom?: string;
    dateTo?: string;
    equipmentId?: string;
  }): Observable<{ data: any[]; total: number }> {
    // Limpiamos los undefined y null de los params
    const cleanParams: any = {};
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') {
        cleanParams[key] = value;
      }
    }
    return this.http.get<{ data: any[]; total: number }>(this.apiUrl, {
      params: cleanParams,
    });
  }

  getStats(): Observable<any> {
    return this.http.get<any>(`${this.apiUrl}/stats`);
  }

  getWorkOrder(id: string): Observable<any> {
    return this.http.get<any>(`${this.apiUrl}/${id}`);
  }

  updateStatus(id: string, status: string, warehouseId?: string) {
    const payload: any = { status };
    if (warehouseId) payload.warehouseId = warehouseId;
    return this.http.patch(`${this.apiUrl}/${id}/status`, payload);
  }
}
