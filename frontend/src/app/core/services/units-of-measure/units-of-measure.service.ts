import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

export interface UnitOfMeasureRow {
  id: string;
  name: string;
  abbreviation: string;
  tenantId?: string;
}

export interface UnitOfMeasurePayload {
  name: string;
  abbreviation: string;
}

@Injectable({
  providedIn: 'root',
})
export class UnitsOfMeasureService {
  private http = inject(HttpClient);
  private base = `${environment.apiUrl}/units-of-measure`;

  list(): Observable<UnitOfMeasureRow[]> {
    return this.http.get<UnitOfMeasureRow[]>(this.base);
  }

  create(data: UnitOfMeasurePayload): Observable<UnitOfMeasureRow> {
    return this.http.post<UnitOfMeasureRow>(this.base, data);
  }

  update(id: string, data: UnitOfMeasurePayload): Observable<UnitOfMeasureRow> {
    return this.http.put<UnitOfMeasureRow>(`${this.base}/${id}`, data);
  }

  remove(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}`);
  }
}
