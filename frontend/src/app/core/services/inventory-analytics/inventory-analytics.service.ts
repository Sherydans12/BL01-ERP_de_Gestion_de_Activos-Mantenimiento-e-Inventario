import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import type { InventoryMasterReportOptions } from '../../models/inventory-master-report-options';

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

export interface FullReportMetaWarehouse {
  id: string;
  code: string;
  name: string;
}

export interface FullReportMetaFamily {
  familyId: string;
  familyName: string;
  totalValue: number;
}

export interface FullReportMetaResponse {
  warehouses: FullReportMetaWarehouse[];
  families: FullReportMetaFamily[];
  catalogItemCount: number;
  grandTotal: number;
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

  /** Resumen por familia (PDF o Excel) — blob para descarga. */
  downloadValuationSummaryReport(format: 'pdf' | 'xlsx'): Observable<Blob> {
    return this.http.get(`${this.apiUrl}/valuation-report`, {
      params: { format },
      responseType: 'blob',
    });
  }

  getFullReportMeta(): Observable<FullReportMetaResponse> {
    return this.http.get<FullReportMetaResponse>(
      `${this.apiUrl}/full-report/meta`,
    );
  }

  private fullReportHttpParams(
    format: 'pdf' | 'xlsx',
    options: InventoryMasterReportOptions,
  ): HttpParams {
    const s = options.sections;
    let params = new HttpParams()
      .set('format', format)
      .set('includeWarehouseSummary', String(s.warehouseSummary))
      .set('includeFamilySummary', String(s.familySummary))
      .set('includeCritical', String(s.criticalItems))
      .set('includeDeadStock', String(s.deadStock))
      .set('includeItemDetail', String(s.itemDetail))
      .set('includePurchases', String(s.purchases))
      .set('onlyWithStock', String(options.onlyWithStock))
      .set('criticalMaxRows', String(options.criticalMaxRows))
      .set('deadStockMaxRows', String(options.deadStockMaxRows))
      .set('purchaseMaxRows', String(options.purchaseMaxRows));

    if (options.warehouseIds.length) {
      params = params.set('warehouseIds', options.warehouseIds.join(','));
    }
    if (options.familyNames.length) {
      params = params.set('familyNames', options.familyNames.join(','));
    }
    if (options.detailMaxRows != null && options.detailMaxRows > 0) {
      params = params.set('detailMaxRows', String(options.detailMaxRows));
    }
    return params;
  }

  /** Reporte maestro de valorización (PDF o Excel) — blob para descarga. */
  downloadFullReport(
    format: 'pdf' | 'xlsx',
    options: InventoryMasterReportOptions,
  ): Observable<Blob> {
    return this.http.get(`${this.apiUrl}/full-report`, {
      params: this.fullReportHttpParams(format, options),
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
