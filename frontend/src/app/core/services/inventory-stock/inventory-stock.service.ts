import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../../environments/environment';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class InventoryStockService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/inventory-stock`;

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

  performTransaction(data: any): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/transaction`, data);
  }

  performReturn(data: any): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/return`, data);
  }
}
