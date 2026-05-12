import { Injectable, signal, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

export interface Tenant {
  id: string;
  code: string;
  name: string;
  rut?: string | null;
  address?: string | null;
  phone?: string | null;
  logoUrl?: string | null;
  primaryColor?: string;
  laborRatePerHour?: number | null;
  backgroundPreference?: 'DARK' | 'LIGHT';
  /** Permisos de sidebar configurados por el ADMIN del tenant. Clave = rol, valor = lista de rutas permitidas. */
  sidebarPermissions?: Record<string, string[]> | null;
  /** Roles custom creados por el ADMIN del tenant. */
  tenantRoles?: Array<{
    id: string;
    name: string;
    description?: string | null;
    baseRole: string;
    routes: string[];
  }> | null;
}

export interface Site {
  id: string;
  name: string;
  code: string;
}

import { environment } from '../../../../environments/environment';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class TenantService {
  private apiUrl = `${environment.apiUrl}/catalogs/sites`;
  public currentTenant = signal<Tenant | null>(null);

  constructor(
    private http: HttpClient,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {}

  // En el futuro, este método leerá el subdominio (ej: tpm.erp.com)
  // o recibirá el código del formulario de login.
  setTenant(tenantData: Tenant) {
    this.currentTenant.set(tenantData);
  }

  getTenantId(): string | null {
    return this.currentTenant()?.id || null;
  }

  getSites(): Observable<Site[]> {
    return this.http.get<Site[]>(this.apiUrl);
  }

  getTenantConfig(): Observable<Tenant> {
    return this.http.get<Tenant>(`${environment.apiUrl}/tenant-config`);
  }

  updateTenantConfig(data: Partial<Tenant>): Observable<Tenant> {
    return this.http.patch<Tenant>(`${environment.apiUrl}/tenant-config`, data);
  }

  // --- MÉTODOS PARA SUPER ADMIN ---
  getPlatformTenants(): Observable<Tenant[]> {
    return this.http.get<Tenant[]>(`${environment.apiUrl}/super-admin/platform/tenants`);
  }

  setSuperAdminTenantId(tenantId: string) {
    if (isPlatformBrowser(this.platformId)) {
      localStorage.setItem('tpm_superadmin_tenant_id', tenantId);
    }
  }

  getSuperAdminTenantId(): string | null {
    if (isPlatformBrowser(this.platformId)) {
      return localStorage.getItem('tpm_superadmin_tenant_id');
    }
    return null;
  }
}
