import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../../environments/environment';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class MaintenanceKitsService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/maintenance-kits`;

  getKits(): Observable<any[]> {
    return this.http.get<any[]>(this.apiUrl);
  }

  getKit(id: string): Observable<any> {
    return this.http.get<any>(`${this.apiUrl}/${id}`);
  }

  createKit(data: any): Observable<any> {
    return this.http.post<any>(this.apiUrl, data);
  }

  updateKit(id: string, data: any): Observable<any> {
    return this.http.put<any>(`${this.apiUrl}/${id}`, data);
  }

  deleteKit(id: string): Observable<any> {
    return this.http.delete<any>(`${this.apiUrl}/${id}`);
  }
}
