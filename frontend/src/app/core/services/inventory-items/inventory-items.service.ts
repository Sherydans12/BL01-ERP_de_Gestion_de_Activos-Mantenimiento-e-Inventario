import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../../environments/environment';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class InventoryItemsService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/inventory-items`;

  getItems(): Observable<any[]> {
    return this.http.get<any[]>(this.apiUrl);
  }

  searchItems(q: string): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/search`, {
      params: { q },
    });
  }

  getItem(id: string): Observable<any> {
    return this.http.get<any>(`${this.apiUrl}/${id}`);
  }

  createItem(data: any): Observable<any> {
    return this.http.post<any>(this.apiUrl, data);
  }

  updateItem(id: string, data: any): Observable<any> {
    return this.http.put<any>(`${this.apiUrl}/${id}`, data);
  }

  deleteItem(id: string): Observable<any> {
    return this.http.delete<any>(`${this.apiUrl}/${id}`);
  }
}
