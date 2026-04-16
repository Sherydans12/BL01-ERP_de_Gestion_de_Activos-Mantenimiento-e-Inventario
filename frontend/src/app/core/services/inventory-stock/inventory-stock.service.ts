import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { environment } from '../../../../environments/environment';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class InventoryStockService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/inventory-stock`;
  private adjustmentsUrl = `${environment.apiUrl}/inventory-adjustments`;

  getStockByWarehouse(warehouseId: string): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/warehouse/${warehouseId}`);
  }

  getTransactionsByWarehouse(warehouseId: string): Observable<any[]> {
    return this.http.get<any[]>(
      `${this.apiUrl}/warehouse/${warehouseId}/transactions`,
    );
  }

  getPendingRegularizations(): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/pending`);
  }

  getPendingCount(): Observable<number> {
    return this.http.get<number>(`${this.apiUrl}/pending/count`);
  }

  getPendingRegularizationPage(
    warehouseId: string,
    params: { page?: number; pageSize?: number },
  ): Observable<{
    data: any[];
    total: number;
    page: number;
    pageSize: number;
    warehouse: { id: string; code: string; name: string };
    receiptsOnApprovedOrdersOnlyCount?: number;
  }> {
    let p = new HttpParams();
    if (params.page != null) p = p.set('page', String(params.page));
    if (params.pageSize != null) p = p.set('pageSize', String(params.pageSize));
    return this.http.get(`${this.apiUrl}/warehouse/${warehouseId}/pending-regularization`, {
      params: p,
    }) as Observable<{
      data: any[];
      total: number;
      page: number;
      pageSize: number;
      warehouse: { id: string; code: string; name: string };
      receiptsOnApprovedOrdersOnlyCount?: number;
    }>;
  }

  /** Alertas de abastecimiento (stock ≤ mínimo, tenant). */
  getSupplyAlerts(): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/supply-alerts`);
  }

  performTransaction(data: any): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/transaction`, data);
  }

  performReturn(data: any): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/return`, data);
  }

  createPhysicalAdjustment(data: {
    warehouseId: string;
    itemId: string;
    newPhysicalQuantity: number;
    reason: 'MERMAS' | 'CONTEO' | 'DANO';
    comment: string;
  }): Observable<any> {
    return this.http.post<any>(this.adjustmentsUrl, data);
  }

  updateStockLevels(
    warehouseId: string,
    itemId: string,
    data: { minStock?: number; maxStock?: number; location?: string | null },
  ): Observable<any> {
    return this.http.put<any>(
      `${this.apiUrl}/warehouse/${warehouseId}/item/${itemId}/levels`,
      data,
    );
  }
}
