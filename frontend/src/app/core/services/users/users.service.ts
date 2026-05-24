import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

export interface User {
  id: string;
  email: string;
  name: string;
  firstName?: string | null;
  lastName?: string | null;
  /** URL firmada o pública para mostrar avatar (listado enriquecido en backend). */
  avatarUrl?: string | null;
  role: string;
  isActive: boolean;
  createdAt: string;
  updatedAt?: string;
  rut?: string;
  phone?: string;
  birthDate?: string;
  position?: string;
  customRoleId?: string | null;
  customRole?: { id: string; name: string; baseRole: string } | null;
  /** `GET /users/assignable-for-ot` */
  canExecuteOt?: boolean;
  canSuperviseOt?: boolean;
  contractAccess?: { contractId: string }[];
  /** Política global: si a este rol podría exigírsele 2FA por correo (IP inusual), según config. */
  emailStepUpPolicyApplies?: boolean;
  /** TOTP (app) activo — hoy relevante para Super Admin. */
  totpEnabled?: boolean;
  /** Aviso por correo en logins poco habituales (perfil de seguridad). */
  notifyUnusualLogin?: boolean;
  /** Permiso explícito para autorizar discrepancias de 3-way match en facturas de compra. */
  canOverruleThreeWayMatch?: boolean;
  /** UUID en BD; útil para soporte / SUPER_ADMIN. */
  tenantId?: string | null;
  tenant?: { id: string; code: string; name: string } | null;
}

export interface PaginatedUsers {
  items: User[];
  meta: {
    total: number;
    page: number;
    lastPage: number;
    limit?: number;
  };
}

/** Respuesta ligera de `GET /users/search-suggestions`. */
export interface UserSearchSuggestion {
  id: string;
  name: string;
  email: string;
  roleLabel: string;
}

@Injectable({
  providedIn: 'root',
})
export class UsersService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/users`;

  /** Mecánicos y supervisores activos del tenant (OT: participantes / supervisor de turno). */
  getAssignableForOt(): Observable<User[]> {
    return this.http.get<User[]>(`${this.apiUrl}/assignable-for-ot`);
  }

  getUsers(
    page: number = 1,
    limit: number = 10,
    search?: string,
  ): Observable<PaginatedUsers> {
    let params = new HttpParams()
      .set('page', String(page))
      .set('limit', String(limit));
    const q = search?.trim();
    if (q) {
      params = params.set('search', q);
    }
    return this.http.get<PaginatedUsers>(this.apiUrl, { params });
  }

  getSearchSuggestions(
    q: string,
    limit = 8,
  ): Observable<{ items: UserSearchSuggestion[] }> {
    const params = new HttpParams()
      .set('q', q.trim())
      .set('limit', String(limit));
    return this.http.get<{ items: UserSearchSuggestion[] }>(
      `${this.apiUrl}/search-suggestions`,
      { params },
    );
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

  /** Reset administrativo (solo otro usuario); no pide contraseña actual. */
  adminSetUserPassword(
    id: string,
    newPassword: string,
  ): Observable<{ success: boolean; message: string }> {
    return this.http.post<{ success: boolean; message: string }>(
      `${this.apiUrl}/${id}/set-password`,
      { newPassword },
    );
  }
}
