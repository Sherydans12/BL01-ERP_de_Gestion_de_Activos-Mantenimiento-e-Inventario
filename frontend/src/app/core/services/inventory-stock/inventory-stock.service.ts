import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { environment } from '../../../../environments/environment';
import { Observable } from 'rxjs';

/** Respuesta de `GET …/transactions?itemId=` (paginado). */
export interface InventoryWarehouseItemTransactionsPage {
  data: unknown[];
  total: number;
  page: number;
  pageSize: number;
}

@Injectable({
  providedIn: 'root',
})
export class InventoryStockService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/inventory-stock`;
  private adjustmentsUrl = `${environment.apiUrl}/inventory-adjustments`;

  getStockByWarehouse(
    warehouseId: string,
    opts?: { location?: string },
  ): Observable<any[]> {
    let params = new HttpParams();
    if (opts?.location?.trim()) {
      params = params.set('location', opts.location.trim());
    }
    return this.http.get<any[]>(`${this.apiUrl}/warehouse/${warehouseId}`, {
      params,
    });
  }

  /**
   * Historial de transacciones de la bodega (sin `itemId`): hasta 100 movimientos, sin paginar.
   * Con `itemId`: respuesta paginada (defecto pág. 1, 25 filas) para kardex por artículo en bodega.
   */
  getTransactionsByWarehouse(
    warehouseId: string,
    opts?: { itemId?: string; page?: number; pageSize?: number },
  ): Observable<any[] | InventoryWarehouseItemTransactionsPage> {
    let params = new HttpParams();
    if (opts?.itemId?.trim()) {
      params = params.set('itemId', opts.itemId.trim());
      params = params.set('page', String(opts.page ?? 1));
      params = params.set('pageSize', String(opts.pageSize ?? 25));
    }
    return this.http.get<any[] | InventoryWarehouseItemTransactionsPage>(
      `${this.apiUrl}/warehouse/${warehouseId}/transactions`,
      { params },
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

  /** IRA (últimos 30 días): ajustes por conteo vs stock en sistema. */
  /** PDF de conteo físico ciego (sin stock sistema). */
  downloadPhysicalCountSheet(warehouseId: string): Observable<Blob> {
    return this.http.get(
      `${this.apiUrl}/warehouse/${warehouseId}/physical-count-sheet/pdf`,
      { responseType: 'blob' },
    );
  }

  getInventoryRecordAccuracy(opts?: { warehouseId?: string }): Observable<{
    periodDays: number;
    numerator: number;
    denominator: number;
    iraPercent: number | null;
    note: string;
  }> {
    let params = new HttpParams();
    if (opts?.warehouseId?.trim()) {
      params = params.set('warehouseId', opts.warehouseId.trim());
    }
    return this.http.get<{
      periodDays: number;
      numerator: number;
      denominator: number;
      iraPercent: number | null;
      note: string;
    }>(`${this.apiUrl}/inventory-record-accuracy`, { params });
  }

  createPhysicalAdjustment(data: {
    warehouseId: string;
    itemId: string;
    newPhysicalQuantity: number;
    reason: 'MERMAS' | 'CONTEO' | 'DANO' | 'SALDO_PENDIENTE';
    comment: string;
    purchaseOrderId?: string;
    purchaseReceiptId?: string;
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

  getStockPosition(
    warehouseId: string,
    itemId: string,
  ): Observable<{ location: string | null; quantityOnHand: number }> {
    return this.http.get<{ location: string | null; quantityOnHand: number }>(
      `${this.apiUrl}/warehouse/${warehouseId}/item/${itemId}/stock-position`,
    );
  }

  listStockReservations(
    warehouseId: string,
    itemId: string,
  ): Observable<
    Array<{
      id: string;
      quantity: number;
      reservedAt: string;
      workOrder: {
        id: string;
        correlative: string;
        responsible: string | null;
        status: string;
      };
    }>
  > {
    return this.http.get<
      Array<{
        id: string;
        quantity: number;
        reservedAt: string;
        workOrder: {
          id: string;
          correlative: string;
          responsible: string | null;
          status: string;
        };
      }>
    >(`${this.apiUrl}/warehouse/${warehouseId}/item/${itemId}/reservations`);
  }
}
