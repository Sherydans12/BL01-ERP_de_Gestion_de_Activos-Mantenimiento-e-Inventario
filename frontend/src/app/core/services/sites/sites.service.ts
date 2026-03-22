import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../../environments/environment';
import { Observable } from 'rxjs';
import { Site } from '../tenant/tenant.service';

@Injectable({
  providedIn: 'root',
})
export class SitesService {
  private apiUrl = `${environment.apiUrl}/sites`;

  constructor(private http: HttpClient) {}

  findAll(): Observable<Site[]> {
    return this.http.get<Site[]>(this.apiUrl);
  }

  create(data: { name: string; code: string }): Observable<Site> {
    return this.http.post<Site>(this.apiUrl, data);
  }

  update(
    id: string,
    data: { name: string; code: string; isActive?: boolean },
  ): Observable<Site> {
    return this.http.put<Site>(`${this.apiUrl}/${id}`, data);
  }

  remove(id: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/${id}`);
  }
}
