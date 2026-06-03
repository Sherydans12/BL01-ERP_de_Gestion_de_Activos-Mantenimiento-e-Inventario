import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

// ── Enums (espejo del backend) ────────────────────────────────────────────────

export type AffectedSystem =
  | 'MOTOR'
  | 'HYDRAULIC'
  | 'ELECTRICAL'
  | 'POWER_TRAIN'
  | 'STRUCTURE'
  | 'GET_WEAR'
  | 'TIRES_TRACKS';

export type FaultCriticality = 'HIGH' | 'MEDIUM' | 'LOW';

export type FaultReportStatus = 'OPEN' | 'LINKED' | 'CLOSED';

// ── Traducciones y tokens visuales ────────────────────────────────────────────

export const SYSTEM_LABELS: Record<AffectedSystem, string> = {
  MOTOR:       'Motor',
  HYDRAULIC:   'Hidráulico',
  ELECTRICAL:  'Eléctrico',
  POWER_TRAIN: 'Tren de Potencia',
  STRUCTURE:   'Estructura',
  GET_WEAR:    'Desgaste (GET)',
  TIRES_TRACKS:'Neumáticos/Orugas',
};

export const AFFECTED_SYSTEMS: AffectedSystem[] = [
  'MOTOR', 'HYDRAULIC', 'ELECTRICAL', 'POWER_TRAIN',
  'STRUCTURE', 'GET_WEAR', 'TIRES_TRACKS',
];

export interface CriticalityMeta {
  label: string;
  subtitle: string;
  /** Clases Tailwind para el badge en lista */
  badgeClass: string;
  /** Clases Tailwind para la tarjeta seleccionada en el formulario */
  cardClass: string;
}

export const CRITICALITY_META: Record<FaultCriticality, CriticalityMeta> = {
  HIGH: {
    label:     'ALTA',
    subtitle:  'Equipo detenido — fuera de servicio',
    badgeClass: 'bg-red-500/20 text-red-400 border border-red-500/30',
    cardClass:  'border-red-500 bg-red-500/10',
  },
  MEDIUM: {
    label:    'MEDIA',
    subtitle: 'Opera con restricciones',
    badgeClass: 'bg-orange-500/20 text-orange-400 border border-orange-500/30',
    cardClass:  'border-orange-500 bg-orange-500/10',
  },
  LOW: {
    label:    'BAJA',
    subtitle: 'Falla menor, sin impacto inmediato',
    badgeClass: 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30',
    cardClass:  'border-yellow-500 bg-yellow-500/10',
  },
};

export const FAULT_CRITICALITIES: FaultCriticality[] = ['HIGH', 'MEDIUM', 'LOW'];

export const STATUS_META: Record<FaultReportStatus, { label: string; badgeClass: string }> = {
  OPEN:   { label: 'Abierto',   badgeClass: 'bg-slate-500/20 text-slate-400 border border-slate-500/30' },
  LINKED: { label: 'Vinculado', badgeClass: 'bg-primary/20 text-primary border border-primary/30' },
  CLOSED: { label: 'Cerrado',   badgeClass: 'bg-green-500/20 text-green-400 border border-green-500/30' },
};

// ── Interfaces de payload ─────────────────────────────────────────────────────

export interface CreateFaultReportPayload {
  equipmentId: string;
  /** ISO 8601 (datetime) */
  eventDate: string;
  meterAtFault?: number;
  affectedSystem: AffectedSystem;
  criticality: FaultCriticality;
  symptomDescription: string;
}

// ── Interfaces de respuesta ───────────────────────────────────────────────────

export interface FaultEquipmentRef {
  id: string;
  internalId: string;
  brand: string;
  model: string;
  plate: string | null;
  isOperational: boolean;
}

export interface FaultWorkOrderRef {
  id: string;
  correlative: string;
  status: string;
}

export interface FaultReportRow {
  id: string;
  correlative: string;
  eventDate: string;
  meterAtFault: number | null;
  affectedSystem: AffectedSystem;
  criticality: FaultCriticality;
  symptomDescription: string;
  status: FaultReportStatus;
  workOrderId: string | null;
  createdAt: string;
  equipment: FaultEquipmentRef;
  reportedBy: { id: string; name: string };
  workOrder: FaultWorkOrderRef | null;
}

export interface FaultReportListResponse {
  data: FaultReportRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface FaultReportListParams {
  page?: number;
  pageSize?: number;
  equipmentId?: string;
  criticality?: FaultCriticality;
  status?: FaultReportStatus;
  dateFrom?: string;
  dateTo?: string;
}

// ── Servicio HTTP ─────────────────────────────────────────────────────────────

@Injectable({ providedIn: 'root' })
export class FaultReportsService {
  private http   = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/fault-reports`;

  create(payload: CreateFaultReportPayload): Observable<FaultReportRow> {
    return this.http.post<FaultReportRow>(this.apiUrl, payload);
  }

  getReports(params: FaultReportListParams = {}): Observable<FaultReportListResponse> {
    let p = new HttpParams();
    if (params.page != null)           p = p.set('page',        String(params.page));
    if (params.pageSize != null)       p = p.set('pageSize',    String(params.pageSize));
    if (params.equipmentId?.trim())    p = p.set('equipmentId', params.equipmentId.trim());
    if (params.criticality)            p = p.set('criticality', params.criticality);
    if (params.status)                 p = p.set('status',      params.status);
    if (params.dateFrom?.trim())       p = p.set('dateFrom',    params.dateFrom.trim());
    if (params.dateTo?.trim())         p = p.set('dateTo',      params.dateTo.trim());
    return this.http.get<FaultReportListResponse>(this.apiUrl, { params: p });
  }

  getReport(id: string): Observable<FaultReportRow> {
    return this.http.get<FaultReportRow>(`${this.apiUrl}/${id}`);
  }

  /** Escala un reporte BAJA a OT correctiva (requiere FAULT_REPORT_MANAGE). */
  createWorkOrder(id: string): Observable<FaultReportRow> {
    return this.http.post<FaultReportRow>(`${this.apiUrl}/${id}/create-work-order`, {});
  }
}
