import { Component, inject, OnInit, signal } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { TenantService, Site } from '../services/tenant/tenant.service';
import { CatalogService } from '../services/catalog/catalog.service';
import { AuthService } from '../services/auth/auth.service';
import { ThemeService } from '../services/theme/theme.service';

@Component({
  selector: 'app-layout',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './layout.component.html',
})
export class LayoutComponent implements OnInit {
  tenantService = inject(TenantService);
  catalogService = inject(CatalogService);
  authService = inject(AuthService);
  themeService = inject(ThemeService);

  currentTenant = this.tenantService.currentTenant;
  currentUser = this.authService.currentUser;
  currentSiteId = this.authService.currentSiteId;

  availableSites = signal<Site[]>([]);
  isSiteDropdownOpen = signal(false);

  logout() {
    this.authService.logout();
  }

  ngOnInit() {
    // Inicializar Tema y Config de Tenant
    this.tenantService.getTenantConfig().subscribe({
      next: (config) => this.tenantService.setTenant(config),
      error: (err) => console.error('Error cargando la config del Tenant', err),
    });

    // Descargar catálogos maestros al entrar a la aplicación
    this.catalogService.loadCatalogs().subscribe({
      error: (err) => console.error('Error cargando catálogos:', err),
    });

    this.loadSites();
  }

  loadSites() {
    const user = this.currentUser();
    console.log('Layout - Diagnóstico Usuario:', {
      role: user?.role,
      allowedSites: user?.allowedSites,
    });
    if (!user) return;

    this.tenantService.getSites().subscribe({
      next: (sites) => {
        console.log('Layout - Sites obtenidos:', sites);
        let finalSites = sites;

        if (sites.length === 0) {
          finalSites = [
            {
              id: 'none',
              name: 'Sin Faenas Creadas',
              code: 'WARN',
            },
          ];
        }

        if (user.role === 'ADMIN' || user.allowedSites?.includes('ALL')) {
          this.availableSites.set(finalSites);
        } else {
          const filtered = finalSites.filter((s) =>
            user.allowedSites?.includes(s.id),
          );
          this.availableSites.set(filtered);
        }
      },
      error: (err) => {
        console.error('Error obteniendo faenas:', err);
        this.availableSites.set([
          {
            id: 'err',
            name: 'Error al cargar faenas',
            code: 'ERR',
          },
        ]);
      },
    });
  }

  toggleSiteDropdown() {
    this.isSiteDropdownOpen.update((v) => !v);
  }

  selectSite(siteId: string) {
    this.authService.setCurrentSite(siteId);
    this.isSiteDropdownOpen.set(false);
  }

  getCurrentSiteName(): string {
    const siteId = this.currentSiteId();
    if (siteId === 'ALL') return 'Todas las Faenas';
    const site = this.availableSites().find((s) => s.id === siteId);
    return site ? site.name : 'Configurando...';
  }
}
