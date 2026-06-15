import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import type { PermissionCatalogModule } from '../../models/permissions-catalog.interface';

export interface TenantRole {
  id: string;
  name: string;
  description?: string | null;
  baseRole: 'SUPER_ADMIN' | 'ADMIN' | 'USER';
  routes: string[];
  permissions?: string[];
  createdAt?: string;
  updatedAt?: string;
  _count?: { users: number };
}

export interface CreateTenantRolePayload {
  name: string;
  description?: string;
  baseRole: 'SUPER_ADMIN' | 'ADMIN' | 'USER';
  routes: string[];
  permissions?: string[];
}

export type UpdateTenantRolePayload = Partial<CreateTenantRolePayload>;

export interface DeleteTenantRolePayload {
  replacementRoleId?: string;
}

@Injectable({ providedIn: 'root' })
export class TenantRolesService {
  private readonly url = `${environment.apiUrl}/tenant-roles`;

  constructor(private http: HttpClient) {}

  getAll(): Observable<TenantRole[]> {
    return this.http.get<TenantRole[]>(this.url);
  }

  getPermissionsCatalog(): Observable<PermissionCatalogModule[]> {
    return this.http.get<PermissionCatalogModule[]>(
      `${this.url}/permissions-catalog`,
    );
  }

  /** Crea roles espejo Sistema · … si faltan y devuelve el listado completo. */
  ensureDefaultRoles(): Observable<TenantRole[]> {
    return this.http.post<TenantRole[]>(`${this.url}/ensure-defaults`, {});
  }

  create(payload: CreateTenantRolePayload): Observable<TenantRole> {
    return this.http.post<TenantRole>(this.url, payload);
  }

  update(id: string, payload: UpdateTenantRolePayload): Observable<TenantRole> {
    return this.http.patch<TenantRole>(`${this.url}/${id}`, payload);
  }

  remove(
    id: string,
    payload?: DeleteTenantRolePayload,
  ): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.url}/${id}`, {
      body: payload,
    });
  }
}
