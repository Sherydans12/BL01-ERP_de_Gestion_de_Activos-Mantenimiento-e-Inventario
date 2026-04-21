import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams, HttpResponse } from '@angular/common/http';
import { environment } from '../../../../environments/environment';
import { Observable } from 'rxjs';

export type PmIntervalSource = 'override' | 'fleet_frequency' | 'heuristic_default';

export interface WorkOrderAnalyticsDashboard {
  period: { from: string; to: string };
  periodHoursTotal: number;
  kpis: {
    fleetAvailabilityPct: number | null;
    mttrHours: number | null;
    mtbfHours: number | null;
    downtimeImpactHoursSi: number;
    correctiveOtCountForMttr: number;
    unplannedFailureIntervalsForMtbf: number;
  };
  availabilityByEquipment: Array<{
    equipmentId: string;
    internalId: string;
    plate: string | null;
    brand: string;
    model: string;
    availabilityPct: number | null;
    downtimeImpactHoursSi: number;
  }>;
  paretoSystems: Array<{
    systemKey: string;
    label: string;
    otCount: number;
  }>;
  programmedSplit: {
    programmed: number;
    notProgrammed: number;
    unknown: number;
  };
}

export interface ProjectedServiceRow {
  equipmentId: string;
  internalId: string;
  plate: string | null;
  brand: string;
  model: string;
  meterType: string;
  currentMeter: number;
  intervalUnits: number;
  intervalSource: PmIntervalSource;
  intervalSourceLabel: string;
  nextDueMeter: number;
  remainingUnits: number;
}

@Injectable({
  providedIn: 'root',
})
export class WorkOrderAnalyticsService {
  private http = inject(HttpClient);
  private baseUrl = `${environment.apiUrl}/work-order-analytics`;

  getDashboard(params: {
    from: string;
    to: string;
    contractId?: string;
  }): Observable<WorkOrderAnalyticsDashboard> {
    let p = new HttpParams()
      .set('from', params.from)
      .set('to', params.to);
    if (params.contractId?.trim()) {
      p = p.set('contractId', params.contractId.trim());
    }
    return this.http.get<WorkOrderAnalyticsDashboard>(
      `${this.baseUrl}/dashboard`,
      { params: p },
    );
  }

  getProjectedServices(params?: {
    limit?: number;
    contractId?: string;
  }): Observable<ProjectedServiceRow[]> {
    let p = new HttpParams();
    if (params?.limit != null) {
      p = p.set('limit', String(params.limit));
    }
    if (params?.contractId?.trim()) {
      p = p.set('contractId', params.contractId.trim());
    }
    return this.http.get<ProjectedServiceRow[]>(
      `${this.baseUrl}/projected-services`,
      { params: p },
    );
  }

  /** Respuesta blob + cabeceras para nombre de archivo. */
  downloadMonthlyManagementPdf(params: {
    year: number;
    month: number;
    contractId?: string;
  }): Observable<HttpResponse<Blob>> {
    let p = new HttpParams()
      .set('year', String(params.year))
      .set('month', String(params.month));
    if (params.contractId?.trim()) {
      p = p.set('contractId', params.contractId.trim());
    }
    return this.http.get(`${this.baseUrl}/report/monthly/pdf`, {
      params: p,
      responseType: 'blob',
      observe: 'response',
    });
  }
}
