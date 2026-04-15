import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

export interface ValuationByFamilyRow {
  familyId: string;
  familyName: string;
  totalValue: number;
}

export interface InventoryValuationResponse {
  grandTotal: number;
  byFamily: ValuationByFamilyRow[];
}

export interface VendorPerformanceRow {
  vendorId: string;
  vendorCode: string;
  vendorName: string;
  receiptsCount: number;
  avgLeadTimeDays: number;
  lateReceiptsCount: number;
  onTimeRate: number;
  grade: 'A' | 'B' | 'C';
}

export interface VendorsPerformanceResponse {
  from: string;
  to: string;
  vendors: VendorPerformanceRow[];
}

export interface SavingsByFamilyRow {
  familyName: string;
  monthlyImpact: number;
  savingsAmount: number;
  overcostAmount: number;
  savingsRate: number;
  comparedItems: number;
}

export interface SavingsVariationResponse {
  month: string;
  comparedItems: number;
  monthlyImpact: number;
  savingsAmount: number;
  overcostAmount: number;
  savingsRate: number;
  byFamily: SavingsByFamilyRow[];
  spotlightFamily: SavingsByFamilyRow | null;
}

export interface GlobalSearchResult {
  kind: 'REQ' | 'PO' | 'INV' | 'WR' | 'OT' | 'EQUIP' | 'ITEM' | 'WH';
  id: string;
  code: string;
  title: string;
}

export interface GlobalSearchResponse {
  query: string;
  results: GlobalSearchResult[];
}

@Injectable({
  providedIn: 'root',
})
export class InventoryAnalyticsService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/inventory-analytics`;

  getValuation(): Observable<InventoryValuationResponse> {
    return this.http.get<InventoryValuationResponse>(
      `${this.apiUrl}/valuation`,
    );
  }

  /** Reporte maestro de valorización (PDF o Excel) — blob para descarga. */
  downloadFullReport(format: 'pdf' | 'xlsx'): Observable<Blob> {
    return this.http.get(`${this.apiUrl}/full-report`, {
      params: { format },
      responseType: 'blob',
    });
  }

  getVendorsPerformance(params?: {
    from?: string;
    to?: string;
  }): Observable<VendorsPerformanceResponse> {
    const query: Record<string, string> = {};
    if (params?.from) query['from'] = params.from;
    if (params?.to) query['to'] = params.to;
    return this.http.get<VendorsPerformanceResponse>(
      `${this.apiUrl}/vendors-performance`,
      { params: query },
    );
  }

  getSavingsVariation(month?: string): Observable<SavingsVariationResponse> {
    const params: Record<string, string> = {};
    if (month) params['month'] = month;
    return this.http.get<SavingsVariationResponse>(
      `${this.apiUrl}/savings-variation`,
      { params },
    );
  }

  globalSearch(query: string): Observable<GlobalSearchResponse> {
    return this.http.get<GlobalSearchResponse>(`${this.apiUrl}/global-search`, {
      params: { q: query },
    });
  }
}
