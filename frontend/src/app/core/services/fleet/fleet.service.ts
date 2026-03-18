import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface PaginatedEquipments {
  data: any[];
  total: number;
  page: number;
  limit: number;
}

@Injectable({
  providedIn: 'root',
})
export class FleetService {
  private http = inject(HttpClient);
  // URL de tu backend
  private apiUrl = 'http://localhost:3000/api/equipments';

  // GET: Traer toda la flota desde PostgreSQL (Paginada y filtrada)
  getEquipments(params?: any): Observable<PaginatedEquipments> {
    let httpParams = new HttpParams();

    if (params) {
      if (params.page) httpParams = httpParams.set('page', params.page);
      if (params.limit) httpParams = httpParams.set('limit', params.limit);
      if (params.search) httpParams = httpParams.set('search', params.search);
      if (params.type) httpParams = httpParams.set('type', params.type);
      if (params.brand) httpParams = httpParams.set('brand', params.brand);
    }

    return this.http.get<PaginatedEquipments>(this.apiUrl, {
      params: httpParams,
    });
  }

  // POST: Crear un nuevo equipo en la BD
  createEquipment(equipmentData: any): Observable<any> {
    return this.http.post<any>(this.apiUrl, equipmentData);
  }

  // PUT: Editar un equipo
  updateEquipment(id: string, equipmentData: any): Observable<any> {
    return this.http.put<any>(`${this.apiUrl}/${id}`, equipmentData);
  }

  // DELETE: Eliminar un equipo
  deleteEquipment(id: string): Observable<any> {
    return this.http.delete<any>(`${this.apiUrl}/${id}`);
  }
}
