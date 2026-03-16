import { Injectable, signal } from '@angular/core';

export interface Tenant {
  id: string;
  name: string;
  logoUrl: string;
}

@Injectable({
  providedIn: 'root',
})
export class TenantService {
  // Usamos Signals (Angular 17+) para manejar el estado global de la empresa de forma reactiva
  public currentTenant = signal<Tenant | null>(null);

  constructor() {}

  // En el futuro, este método leerá el subdominio (ej: tpm.erp.com)
  // o recibirá el código del formulario de login.
  setTenant(tenantData: Tenant) {
    this.currentTenant.set(tenantData);
  }

  getTenantId(): string | null {
    return this.currentTenant()?.id || null;
  }
}
