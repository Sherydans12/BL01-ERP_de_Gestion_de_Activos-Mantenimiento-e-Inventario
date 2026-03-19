import { Component, inject, OnInit } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { TenantService } from '../services/tenant/tenant.service';
import { CatalogService } from '../services/catalog/catalog.service';
import { AuthService } from '../services/auth/auth.service';

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

  currentTenant = this.tenantService.currentTenant;
  currentUser = this.authService.currentUser;

  logout() {
    this.authService.logout();
  }

  ngOnInit() {
    // Descargar catálogos maestros al entrar a la aplicación
    this.catalogService.loadCatalogs().subscribe({
      error: (err) => console.error('Error cargando catálogos:', err),
    });
  }
}
