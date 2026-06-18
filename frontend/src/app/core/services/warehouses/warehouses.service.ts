import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { environment } from '../../../../environments/environment';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class WarehousesService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/warehouses`;

  getWarehouses(): Observable<any[]> {
    return this.http.get<any[]>(this.apiUrl);
  }

  getWarehousesForTransfer(): Observable<any[]> {
    const params = new HttpParams().set('scope', 'transfer');
    return this.http.get<any[]>(this.apiUrl, { params });
  }

  getWarehousesByContract(contractId: string): Observable<any[]> {
    return this.http.get<any[]>(this.apiUrl, {
      params: { contractId },
    });
  }

  getWarehouse(id: string): Observable<any> {
    return this.http.get<any>(`${this.apiUrl}/${id}`);
  }

  createWarehouse(data: any): Observable<any> {
    return this.http.post<any>(this.apiUrl, data);
  }

  updateWarehouse(id: string, data: any): Observable<any> {
    return this.http.put<any>(`${this.apiUrl}/${id}`, data);
  }

  deleteWarehouse(id: string): Observable<any> {
    return this.http.delete<any>(`${this.apiUrl}/${id}`);
  }
}
