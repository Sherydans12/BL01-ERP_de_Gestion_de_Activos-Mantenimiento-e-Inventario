import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

// ── Payload de creación ──────────────────────────────────────────────────

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
  meterReading?: number;
  notes?: string;
  lines: LubeReportLinePayload[];
}

// ── Respuestas del servidor ──────────────────────────────────────────────

export interface LubeReportEquipmentRef {
  id: string;
  internalId: string | null;
  brand: string;
  model: string;
  plate: string | null;
}

export interface LubeReportWarehouseRef {
  id: string;
  code: string;
  name: string;
}

export interface LubeReportUserRef {
  id: string;
  name: string;
}

export interface LubeReportRow {
  id: string;
  correlative: string;
  dispatchDate: string;
  meterReading: number | null;
  notes: string | null;
  createdAt: string;
  equipment: LubeReportEquipmentRef;
  warehouse: LubeReportWarehouseRef;
  user: LubeReportUserRef;
  lineCount: number;
}

export interface LubeReportLineDetail {
  id: string;
  itemId: string;
  quantity: number;
  unitCost: string | number;
  item: {
    id: string;
    name: string;
    inventoryCode: string | null;
    partNumber: string | null;
    unitOfMeasure: { id: string; name: string; abbreviation: string };
  };
}

export interface LubeReportDetail extends Omit<LubeReportRow, 'lineCount'> {
  lines: LubeReportLineDetail[];
}

export interface LubeReportListResponse {
  data: LubeReportRow[];
  total: number;
  page: number;
  pageSize: number;
}

// ── Parámetros de consulta ───────────────────────────────────────────────

export interface LubeReportListParams {
  page?: number;
  pageSize?: number;
  warehouseId?: string;
  equipmentId?: string;
  dateFrom?: string;
  dateTo?: string;
}

@Injectable({ providedIn: 'root' })
export class LubeReportsService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/lube-reports`;

  createReport(payload: CreateLubeReportPayload): Observable<LubeReportRow> {
    return this.http.post<LubeReportRow>(this.apiUrl, payload);
  }

  getReports(params: LubeReportListParams = {}): Observable<LubeReportListResponse> {
    let p = new HttpParams();
    if (params.page != null)        p = p.set('page',        String(params.page));
    if (params.pageSize != null)    p = p.set('pageSize',    String(params.pageSize));
    if (params.warehouseId?.trim()) p = p.set('warehouseId', params.warehouseId.trim());
    if (params.equipmentId?.trim()) p = p.set('equipmentId', params.equipmentId.trim());
    if (params.dateFrom?.trim())    p = p.set('dateFrom',    params.dateFrom.trim());
    if (params.dateTo?.trim())      p = p.set('dateTo',      params.dateTo.trim());
    return this.http.get<LubeReportListResponse>(this.apiUrl, { params: p });
  }

  getReport(id: string): Observable<LubeReportDetail> {
    return this.http.get<LubeReportDetail>(`${this.apiUrl}/${id}`);
  }
}
