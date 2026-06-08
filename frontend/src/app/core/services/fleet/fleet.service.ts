import { Injectable, inject, signal, computed, Signal } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { FleetStateService } from '../fleet-state/fleet-state.service';
import {
  Equipment,
  EquipmentAnalytics,
  EquipmentMeterSnapshot,
  MeterCaptureBoardResponse,
  MeterBulkSyncItem,
  MeterBulkSyncResponse,
} from '../../models/types';

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
  private fleetState = inject(FleetStateService);
  private apiUrl = `${environment.apiUrl}/equipments`;

  /**
   * Versión incremental de la caché de listados de flota.
   * Otros módulos (p. ej. Registro de Fallas) llaman `invalidateCache()` para que las
   * vistas abiertas que la observan vía `effect()` vuelvan a pedir datos al backend.
   * Ver §2.4 «Ecosistema de Operaciones y Flota» en docs/MASTER-CONTEXT.md.
   */
  private readonly _listVersion = signal(0);
  readonly listVersion = this._listVersion.asReadonly();

  /** Revisión por equipo — modales abiertos observan esto para refetch. */
  private readonly _equipmentRevision = signal<Record<string, number>>({});

  /**
   * Señal de revisión para un equipo concreto (p. ej. modal de detalle).
   */
  equipmentRevision(equipmentId: string): Signal<number> {
    return computed(() => this._equipmentRevision()[equipmentId] ?? 0);
  }

  /**
   * Marca la lista de equipos como obsoleta. La señal `listVersion` cambia y cualquier
   * componente que la lea dentro de un `effect()` (p. ej. `FleetMasterComponent`) recargará.
   */
  invalidateCache(): void {
    this._listVersion.update((v) => v + 1);
  }

  /**
   * Invalida la lista y bump de revisión para un equipo (M2 detención, M3, OT).
   */
  notifyEquipmentChanged(equipmentId: string): void {
    this.invalidateCache();
    this.fleetState.notify(equipmentId);
    this._equipmentRevision.update((m) => ({
      ...m,
      [equipmentId]: (m[equipmentId] ?? 0) + 1,
    }));
  }

  /** Alias semántico de `notifyEquipmentChanged`. */
  bumpEquipmentRevision(equipmentId: string): void {
    this.notifyEquipmentChanged(equipmentId);
  }

  /**
   * Lista equipos. Si se pasa `contractId`, se envía `x-contract-id` para filtrar por ese contrato
   * (el interceptor no lo sobrescribe si ya viene fijado).
   *
   * `noCache` agrega un sello temporal (`_ts`) para defender la frescura ante cualquier
   * caché HTTP/proxy/SW intermedio (estado `isOperational` recién mutado por una falla).
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
      /** Cache-bust: agrega `_ts` para evitar respuestas cacheadas. */
      noCache?: boolean;
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
      if (params.noCache)
        httpParams = httpParams.set('_ts', String(Date.now()));
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

  /**
   * Refetch explícito de la lista, forzando cache-bust HTTP. Alias semántico de
   * `getEquipments({ ...params, noCache: true })` para usar al re-entrar a `/flota`.
   */
  refetch(
    params?: {
      page?: number;
      limit?: number;
      search?: string;
      type?: string;
      brand?: string;
      contractId?: string;
    },
    options?: { contractId?: string },
  ): Observable<PaginatedEquipments> {
    return this.getEquipments({ ...(params ?? {}), noCache: true }, options);
  }

  getEquipmentById(id: string): Observable<Equipment> {
    return this.http.get<Equipment>(`${this.apiUrl}/${id}`);
  }

  getEquipmentResumePdf(id: string): Observable<Blob> {
    return this.http.get(`${this.apiUrl}/${id}/resume-pdf`, {
      responseType: 'blob',
    });
  }

  getEquipmentAnalytics(id: string): Observable<EquipmentAnalytics> {
    return this.http.get<EquipmentAnalytics>(
      `${this.apiUrl}/${id}/analytics`,
    );
  }

  getEquipmentMeterSnapshot(id: string): Observable<EquipmentMeterSnapshot> {
    return this.http.get<EquipmentMeterSnapshot>(
      `${this.apiUrl}/${id}/meter-snapshot`,
    );
  }

  getMeterCaptureBoard(
    params?: { type?: string; search?: string; limit?: number },
    options?: { contractId?: string | null },
  ): Observable<MeterCaptureBoardResponse> {
    let httpParams = new HttpParams();
    if (params?.type) httpParams = httpParams.set('type', params.type);
    if (params?.search) httpParams = httpParams.set('search', params.search);
    if (params?.limit)
      httpParams = httpParams.set('limit', String(params.limit));

    let headers = new HttpHeaders();
    const c = options?.contractId;
    if (c) {
      headers = headers.set('x-contract-id', c);
    }

    return this.http.get<MeterCaptureBoardResponse>(
      `${this.apiUrl}/meter-capture-board`,
      { params: httpParams, headers },
    );
  }

  bulkSyncMeterReadings(
    body: { items: MeterBulkSyncItem[] },
    options?: { contractId?: string | null },
  ): Observable<MeterBulkSyncResponse> {
    let headers = new HttpHeaders();
    const c = options?.contractId;
    if (c) {
      headers = headers.set('x-contract-id', c);
    }
    return this.http.post<MeterBulkSyncResponse>(
      `${this.apiUrl}/meter-readings/bulk-sync`,
      body,
      { headers },
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
