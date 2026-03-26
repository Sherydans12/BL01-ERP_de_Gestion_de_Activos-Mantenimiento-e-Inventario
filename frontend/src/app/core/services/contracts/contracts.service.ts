import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../../environments/environment';
import { Observable } from 'rxjs';
import { Contract } from '../../models/types';

@Injectable({
  providedIn: 'root',
})
export class ContractsService {
  private apiUrl = `${environment.apiUrl}/contracts`;

  constructor(private http: HttpClient) {}

  findAll(): Observable<Contract[]> {
    return this.http.get<Contract[]>(this.apiUrl);
  }

  create(data: { name: string; code: string }): Observable<Contract> {
    return this.http.post<Contract>(this.apiUrl, data);
  }

  update(
    id: string,
    data: { name: string; code: string; isActive?: boolean },
  ): Observable<Contract> {
    return this.http.put<Contract>(`${this.apiUrl}/${id}`, data);
  }

  remove(id: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/${id}`);
  }
}
