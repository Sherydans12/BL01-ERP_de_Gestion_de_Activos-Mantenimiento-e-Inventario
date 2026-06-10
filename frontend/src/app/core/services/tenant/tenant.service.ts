import { Injectable, signal, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

export interface Tenant {
  id: string;
  code: string;
  name: string;
  rut?: string | null;
  address?: string | null;
  phone?: string | null;
  city?: string | null;
  /** Razón social para facturas / OC (persistido). */
  invoiceLegalName?: string | null;
  /** Aviso legal del recuadro en el PDF de OC (multilínea). Vacío = texto por defecto en el generador. */
  ocPdfLegalNotice?: string | null;
  /** Clave de storage o URL externa (persistido). Solo menú lateral / layout. */
  logoUrl?: string | null;
  /** URL lista para `<img src>` (p. ej. firmada en R2). Menú lateral. */
  logoPublicUrl?: string | null;
  /** Variante del logo del menú para tema claro (misma semántica que `logoUrl`). */
  logoLightUrl?: string | null;
  logoLightPublicUrl?: string | null;
  /** Logo ancho para PDFs de compras (OC, SRC, reporte ejecutivo). Independiente del menú. */
  pdfLogoUrl?: string | null;
  pdfLogoPublicUrl?: string | null;
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
  /** Configuración operativa: gestión de turnos. Lazy-created; null = usar defaults del sistema. */
  operationalConfig?: TenantOperationalConfig | null;
}

export interface TenantOperationalConfig {
  hasNightShift: boolean;
  dayShiftStartTime: string;
  nightShiftStartTime: string;
  blockNegativeStock?: boolean;
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

  updateOperationalConfig(data: Partial<TenantOperationalConfig>): Observable<TenantOperationalConfig> {
    return this.http.patch<TenantOperationalConfig>(
      `${environment.apiUrl}/tenant-config/operational`,
      data,
    );
  }

  /** Sube logo de marca (PNG/JPEG/WebP, máx. 2 MB). Devuelve tenant con `logoUrl` + `logoPublicUrl`. */
  uploadTenantLogo(file: File): Observable<Tenant> {
    const fd = new FormData();
    fd.append('file', file);
    return this.http.post<Tenant>(
      `${environment.apiUrl}/tenant-config/logo`,
      fd,
    );
  }

  /** Variante del logo del menú para tema claro (misma validación que el logo principal). */
  uploadTenantLogoLight(file: File): Observable<Tenant> {
    const fd = new FormData();
    fd.append('file', file);
    return this.http.post<Tenant>(
      `${environment.apiUrl}/tenant-config/logo-light`,
      fd,
    );
  }

  /** Logo dedicado a PDFs de compras (misma validación que el logo del menú: máx. 2 MB, PNG/JPEG/WebP). */
  uploadTenantPdfLogo(file: File): Observable<Tenant> {
    const fd = new FormData();
    fd.append('file', file);
    return this.http.post<Tenant>(
      `${environment.apiUrl}/tenant-config/pdf-logo`,
      fd,
    );
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
