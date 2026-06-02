import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

export interface LubeReportLinePayload {
  itemId: string;
  quantity: number;
}

export interface CreateLubeReportPayload {
  contractId: string;
  equipmentId: string;
  warehouseId: string;
  /** ISO 8601 */
  dispatchDate: string;
  /** Horómetro/cuentakilómetros al momento del despacho (opcional). */
  meterReading?: number;
  notes?: string;
  lines: LubeReportLinePayload[];
}

export interface LubeReportCreated {
  id: string;
  correlative: string;
  tenantId: string;
  contractId: string;
  equipmentId: string;
  warehouseId: string;
  userId: string;
  dispatchDate: string;
  meterReading: number | null;
  notes: string | null;
  createdAt: string;
}

@Injectable({ providedIn: 'root' })
export class LubeReportsService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/lube-reports`;

  createReport(payload: CreateLubeReportPayload): Observable<LubeReportCreated> {
    return this.http.post<LubeReportCreated>(this.apiUrl, payload);
  }
}
