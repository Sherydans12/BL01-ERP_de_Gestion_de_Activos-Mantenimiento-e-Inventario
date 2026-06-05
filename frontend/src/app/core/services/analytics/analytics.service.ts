import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

/** Espejo de `KpiDashboardResponse` del backend (DateTime → string ISO). */
export interface KpiDashboardResponse {
  period: { from: string; to: string };
  contractId: string | null;
  kpis: {
    physicalAvailabilityPct: number | null;
    mttrHours: number | null;
    mtbfHours: number | null;
  };
  physicalAvailability: {
    operationalShiftHours: number;
    totalShiftHours: number;
    reportedShifts: number;
    operationalShifts: number;
  };
  mttr: {
    correctiveOtCount: number;
    totalRepairHours: number;
  };
  mtbf: {
    criticalFaultCount: number;
    intervalCount: number;
  };
  lubeTrendMonthly: LubeTrendMonthPoint[];
  meta: {
    cached: boolean;
    generatedAt: string;
  };
}

export interface LubeTrendMonthPoint {
  month: string;
  totalLiters: number;
  machineHours: number;
  litersPerMachineHour: number | null;
}

@Injectable({ providedIn: 'root' })
export class AnalyticsService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/analytics`;

  getKpiDashboard(params: {
    from: string;
    to: string;
    contractId?: string;
  }): Observable<KpiDashboardResponse> {
    let httpParams = new HttpParams()
      .set('from', params.from)
      .set('to', params.to);
    if (params.contractId) {
      httpParams = httpParams.set('contractId', params.contractId);
    }
    return this.http.get<KpiDashboardResponse>(`${this.apiUrl}/kpi-dashboard`, {
      params: httpParams,
    });
  }
}
