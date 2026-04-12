import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../../environments/environment';
import { Observable } from 'rxjs';

export interface Vendor {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  rut?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  address?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

@Injectable({ providedIn: 'root' })
export class VendorsService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/vendors`;

  getAll(): Observable<Vendor[]> {
    return this.http.get<Vendor[]>(this.apiUrl);
  }

  getById(id: string): Observable<Vendor> {
    return this.http.get<Vendor>(`${this.apiUrl}/${id}`);
  }

  create(data: Partial<Vendor>): Observable<Vendor> {
    return this.http.post<Vendor>(this.apiUrl, data);
  }

  update(id: string, data: Partial<Vendor>): Observable<Vendor> {
    return this.http.patch<Vendor>(`${this.apiUrl}/${id}`, data);
  }

  remove(id: string): Observable<Vendor> {
    return this.http.delete<Vendor>(`${this.apiUrl}/${id}`);
  }
}
