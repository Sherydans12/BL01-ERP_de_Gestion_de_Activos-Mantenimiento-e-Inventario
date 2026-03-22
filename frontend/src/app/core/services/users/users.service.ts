import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

export interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  isActive: boolean;
  createdAt: string;
  rut?: string;
  phone?: string;
  birthDate?: string;
  position?: string;
  siteAccess?: { siteId: string }[];
}

export interface PaginatedUsers {
  items: User[];
  meta: {
    total: number;
    page: number;
    lastPage: number;
  };
}

@Injectable({
  providedIn: 'root',
})
export class UsersService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/users`;

  getUsers(page: number = 1, limit: number = 10): Observable<PaginatedUsers> {
    const params = new HttpParams()
      .set('page', page.toString())
      .set('limit', limit.toString());

    return this.http.get<PaginatedUsers>(this.apiUrl, { params });
  }

  createUser(data: any): Observable<User> {
    return this.http.post<User>(this.apiUrl, data);
  }

  updateUser(id: string, data: Partial<User>): Observable<User> {
    return this.http.patch<User>(`${this.apiUrl}/${id}`, data);
  }

  deleteUser(id: string): Observable<any> {
    return this.http.delete(`${this.apiUrl}/${id}`);
  }
  /**
   * Solicita al servidor el reenvío del correo de activación.
   * Generará un nuevo token y enviará el email vía Ethereal/SMTP.
   */
  resendActivation(
    id: string,
  ): Observable<{ success: boolean; message: string }> {
    return this.http.post<{ success: boolean; message: string }>(
      `${this.apiUrl}/${id}/resend-activation`,
      {}, // Body vacío ya que el ID va en la URL
    );
  }
}
