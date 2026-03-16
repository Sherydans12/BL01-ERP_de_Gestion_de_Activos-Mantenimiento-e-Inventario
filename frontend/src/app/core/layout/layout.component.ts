import { Component, inject } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { TenantService } from '../services/tenant/tenant.service';

@Component({
  selector: 'app-layout',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './layout.component.html',
})
export class LayoutComponent {
  tenantService = inject(TenantService);
  // Obtenemos la empresa actual para mostrarla en el menú
  currentTenant = this.tenantService.currentTenant;
}
