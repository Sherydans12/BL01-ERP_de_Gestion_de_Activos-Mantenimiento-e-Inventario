import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import type { DashboardStats } from '../../models/dashboard-stats';

export type AvailabilityImpact = 'SI' | 'NO' | 'STP';
export type EquipmentWorkLocation = 'TALLER' | 'TERRENO';
export type WorkShift = 'DIA' | 'NOCHE';
export type FluidCompartment =
  | 'MOTOR'
  | 'TRANSMISION'
  | 'DIRECCION'
  | 'HIDRAULICO'
  | 'MANDOS'
  | 'DIFERENCIAL'
  | 'REFRIGERANTE'
  | 'OTROS';

/** Chips de clasificación enviados al backend (tipo único + subtipo NP). */
export type OtClassificationTag =
  | 'PROGRAMADA'
  | 'NO_PROGRAMADA'
  | 'NP_PREVENTIVO'
  | 'NP_CORRECTIVO'
  | 'ACCIDENTE_INCIDENTE'
  | 'OT_ABIERTA_CONTINUIDAD'
  | 'OT_ABIERTA_GEN_BCK'
  | 'POSIBLE_GARANTIA';

export interface FluidCompartmentRowPayload {
  compartment: FluidCompartment;
  /** Etiqueta derivada del ítem de inventario (el backend puede sobrescribirla). */
  fluidType: string;
  liters: number;
  action: 'RELLENO' | 'CAMBIO';
  /** Obligatorio: el fluido debe existir en el inventario de la empresa. */
  inventoryItemId: string;
}

export interface CreateWorkOrderExcelPayload {
  equipmentId: string;
  warehouseId?: string;

  detentionStartedAt?: string;
  detentionEndedAt?: string;
  detentionInitialMeter?: number;
  detentionFinalMeter?: number;

  mechanicAttentionStartedAt?: string;
  mechanicAttentionEndedAt?: string;
  personnelQuantity?: number;

  clientAttributedStart?: string;
  clientAttributedEnd?: string;
  clientAttributedReason?: string;

  affectsAvailability?: AvailabilityImpact;
  classificationTags?: OtClassificationTag[];

  workLocation?: EquipmentWorkLocation;
  workShift?: WorkShift;

  /** IDs de ítems de catálogo (familia Sistemas / hijos). */
  systems?: string[];

  initialRequestDescription?: string;
  symptomsText?: string;
  causeText?: string;
  workPerformedDescription?: string;

  techniciansNames?: string;
  responsibleMechanicName?: string;
  responsibleMechanicSignature?: string;
  shiftSupervisorName?: string;
  shiftSupervisorSignature?: string;
  participantUserIds?: string[];
  shiftSupervisorUserId?: string | null;

  pmCycleNumber?: number | null;

  fluidCompartments?: FluidCompartmentRowPayload[];

  /** Repuestos: cada línea debe ir enlazada a un ítem del inventario. */
  parts?: {
    partNumber: string;
    description: string;
    quantity: number;
    inventoryItemId: string;
  }[];
}

export interface BacklogItemDto {
  id: string;
  workOrderId: string;
  description: string;
  status: 'PENDING' | 'DONE';
  createdAt: string;
  updatedAt: string;
  workOrder?: {
    id: string;
    correlative: string;
    status: string;
    equipment?: { internalId: string; brand?: string; model?: string };
  };
}

export interface BacklogListResponse {
  data: BacklogItemDto[];
  total: number;
  limit: number;
  offset: number;
}

@Injectable({
  providedIn: 'root',
})
export class WorkOrdersService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/work-orders`;

  createOT(payload: CreateWorkOrderExcelPayload): Observable<any> {
    return this.http.post(this.apiUrl, payload);
  }

  patchWorkOrder(
    id: string,
    payload: Partial<CreateWorkOrderExcelPayload>,
  ): Observable<any> {
    return this.http.patch(`${this.apiUrl}/${id}`, payload);
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
    const cleanParams: Record<string, string | number> = {};
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') {
        cleanParams[key] = value as string | number;
      }
    }
    return this.http.get<{ data: any[]; total: number }>(this.apiUrl, {
      params: cleanParams,
    });
  }

  getWorkOrdersForContract(
    contractId: string,
    params?: {
      page?: number;
      limit?: number;
      search?: string;
      status?: string;
    },
  ): Observable<{ data: any[]; total: number }> {
    const cleanParams: Record<string, string | number> = {
      page: params?.page ?? 1,
      limit: params?.limit ?? 300,
    };
    if (params?.search) cleanParams['search'] = params.search;
    if (params?.status) cleanParams['status'] = params.status;
    const headers = new HttpHeaders().set('x-contract-id', contractId);
    return this.http.get<{ data: any[]; total: number }>(this.apiUrl, {
      params: cleanParams,
      headers,
    });
  }

  getStats(): Observable<DashboardStats> {
    return this.http.get<DashboardStats>(`${this.apiUrl}/stats`);
  }

  getWorkOrder(id: string): Observable<any> {
    return this.http.get<any>(`${this.apiUrl}/${id}`);
  }

  updateStatus(
    id: string,
    status: string,
    warehouseId?: string,
    closureEquipmentOperational?: boolean,
    confirmedLargeJump?: boolean,
  ) {
    const payload: Record<string, string | boolean> = { status };
    if (warehouseId) payload['warehouseId'] = warehouseId;
    if (closureEquipmentOperational !== undefined) {
      payload['closureEquipmentOperational'] = closureEquipmentOperational;
    }
    if (confirmedLargeJump === true) {
      payload['confirmedLargeJump'] = true;
    }
    return this.http.patch(`${this.apiUrl}/${id}/status`, payload);
  }

  listBacklog(options?: {
    status?: 'PENDING' | 'DONE';
    limit?: number;
    offset?: number;
    search?: string;
  }): Observable<BacklogListResponse> {
    const params: Record<string, string | number> = {};
    if (options?.status) params['status'] = options.status;
    if (options?.limit != null) params['limit'] = options.limit;
    if (options?.offset != null) params['offset'] = options.offset;
    if (options?.search?.trim()) params['search'] = options.search.trim();
    return this.http.get<BacklogListResponse>(`${this.apiUrl}/backlog`, {
      params,
    });
  }

  addBacklogItem(
    workOrderId: string,
    description: string,
  ): Observable<BacklogItemDto> {
    return this.http.post<BacklogItemDto>(
      `${this.apiUrl}/${workOrderId}/backlog`,
      {
        description,
      },
    );
  }

  patchBacklogItem(
    workOrderId: string,
    itemId: string,
    status: 'PENDING' | 'DONE',
  ): Observable<BacklogItemDto> {
    return this.http.patch<BacklogItemDto>(
      `${this.apiUrl}/${workOrderId}/backlog/${itemId}`,
      { status },
    );
  }

  promoteBacklogItem(
    workOrderId: string,
    itemId: string,
    mode: 'TO_TASK' | 'TO_NEW_OT',
  ): Observable<{
    promoted: boolean;
    mode: string;
    newWorkOrderId?: string;
  }> {
    return this.http.post<{
      promoted: boolean;
      mode: string;
      newWorkOrderId?: string;
    }>(`${this.apiUrl}/${workOrderId}/backlog/${itemId}/promote`, {
      mode,
    });
  }
}
