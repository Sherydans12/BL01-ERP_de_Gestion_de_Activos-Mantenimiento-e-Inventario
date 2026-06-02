import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

// ── Enums (espejados desde el backend — deben estar sincronizados con Prisma) ──

export type ShiftType = 'DAY' | 'NIGHT';
export type OperationalStatus =
  | 'OPERATIONAL'
  | 'STANDBY'
  | 'RESERVE_NO_OPERATOR'
  | 'DOWN_FAILURE'
  | 'DOWN_MAINTENANCE';

/** Labels en español para mostrar en la UI. */
export const SHIFT_LABELS: Record<ShiftType, string> = {
  DAY: 'Turno Día',
  NIGHT: 'Turno Noche',
};

export const STATUS_LABELS: Record<OperationalStatus, string> = {
  OPERATIONAL: 'Operativo',
  STANDBY: 'Standby',
  RESERVE_NO_OPERATOR: 'Reserva sin operador',
  DOWN_FAILURE: 'Detenido por Falla',
  DOWN_MAINTENANCE: 'Detenido por Mantención',
};

/** Colores semánticos para badges de estado. */
export const STATUS_COLORS: Record<OperationalStatus, string> = {
  OPERATIONAL: 'text-green-400',
  STANDBY: 'text-blue-400',
  RESERVE_NO_OPERATOR: 'text-yellow-400',
  DOWN_FAILURE: 'text-red-400',
  DOWN_MAINTENANCE: 'text-orange-400',
};

export const SHIFTS: ShiftType[] = ['DAY', 'NIGHT'];
export const OPERATIONAL_STATUSES: OperationalStatus[] = [
  'OPERATIONAL',
  'STANDBY',
  'RESERVE_NO_OPERATOR',
  'DOWN_FAILURE',
  'DOWN_MAINTENANCE',
];

// ── Payload de creación ────────────────────────────────────────────────────

export interface CreateAvailabilityPayload {
  equipmentId: string;
  /** ISO 8601 date string (ej: "2026-06-02"). */
  reportDate: string;
  shift: ShiftType;
  status: OperationalStatus;
  meterReading?: number;
  comments?: string;
}

// ── Respuestas del servidor ────────────────────────────────────────────────

export interface AvailabilityEquipmentRef {
  id: string;
  internalId: string;
  brand: string;
  model: string;
  plate: string | null;
}

export interface AvailabilityUserRef {
  id: string;
  name: string;
}

export interface AvailabilityRecord {
  id: string;
  tenantId: string;
  contractId: string | null;
  equipmentId: string;
  reportedById: string;
  reportDate: string;
  shift: ShiftType;
  status: OperationalStatus;
  meterReading: number | null;
  comments: string | null;
  isAvailable: boolean;
  createdAt: string;
  updatedAt: string;
  equipment: AvailabilityEquipmentRef;
  reportedBy: AvailabilityUserRef;
}

export interface AvailabilityListResponse {
  data: AvailabilityRecord[];
  total: number;
  page: number;
  pageSize: number;
}

/** Equipo sin reporte en el turno consultado. */
export interface UnreportedEquipment {
  id: string;
  internalId: string;
  brand: string;
  model: string;
  plate: string | null;
  contractId: string | null;
}

// ── Parámetros de consulta ─────────────────────────────────────────────────

export interface AvailabilityListParams {
  page?: number;
  pageSize?: number;
  equipmentId?: string;
  shift?: ShiftType;
  dateFrom?: string;
  dateTo?: string;
}

export interface UnreportedParams {
  date: string;
  shift: ShiftType;
  contractId?: string;
}

// ── Servicio ──────────────────────────────────────────────────────────────

@Injectable({ providedIn: 'root' })
export class EquipmentAvailabilityService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/equipment-availability`;

  create(payload: CreateAvailabilityPayload): Observable<AvailabilityRecord> {
    return this.http.post<AvailabilityRecord>(this.apiUrl, payload);
  }

  getAll(params: AvailabilityListParams = {}): Observable<AvailabilityListResponse> {
    let p = new HttpParams();
    if (params.page != null)         p = p.set('page',        String(params.page));
    if (params.pageSize != null)     p = p.set('pageSize',    String(params.pageSize));
    if (params.equipmentId?.trim())  p = p.set('equipmentId', params.equipmentId.trim());
    if (params.shift)                p = p.set('shift',       params.shift);
    if (params.dateFrom?.trim())     p = p.set('dateFrom',    params.dateFrom.trim());
    if (params.dateTo?.trim())       p = p.set('dateTo',      params.dateTo.trim());
    return this.http.get<AvailabilityListResponse>(this.apiUrl, { params: p });
  }

  getOne(id: string): Observable<AvailabilityRecord> {
    return this.http.get<AvailabilityRecord>(`${this.apiUrl}/${id}`);
  }

  getUnreported(params: UnreportedParams): Observable<UnreportedEquipment[]> {
    let p = new HttpParams()
      .set('date', params.date)
      .set('shift', params.shift);
    if (params.contractId) p = p.set('contractId', params.contractId);
    return this.http.get<UnreportedEquipment[]>(
      `${this.apiUrl}/unreported`,
      { params: p },
    );
  }
}
