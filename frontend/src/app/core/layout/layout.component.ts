import { Component, inject, OnInit, PLATFORM_ID, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { TenantService } from '../services/tenant/tenant.service';
import { CatalogService } from '../services/catalog/catalog.service';
import { AuthService } from '../services/auth/auth.service';
import { ThemeService } from '../services/theme/theme.service';
import { ContractsService } from '../services/contracts/contracts.service'; // Ajusta la ruta si es necesario
import { Contract } from '../models/types';

@Component({
  selector: 'app-layout',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './layout.component.html',
})
export class LayoutComponent implements OnInit {
  private platformId = inject(PLATFORM_ID);

  tenantService = inject(TenantService);
  catalogService = inject(CatalogService);
  authService = inject(AuthService);
  themeService = inject(ThemeService);
  contractsService = inject(ContractsService);

  currentTenant = this.tenantService.currentTenant;
  currentUser = this.authService.currentUser;
  currentContractId = this.authService.currentContractId;

  availableContracts = signal<Contract[]>([]);
  isContractDropdownOpen = signal(false);

  logout() {
    this.authService.logout();
  }

  ngOnInit() {
    // En SSR no hay token ni localStorage: no llamar APIs protegidas (el guard
    // ya bloquea la ruta, pero esto evita fugas si el layout se reutiliza).
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    this.tenantService.getTenantConfig().subscribe({
      next: (config) => this.tenantService.setTenant(config),
      error: (err) => console.error('Error cargando la config del Tenant', err),
    });

    this.catalogService.loadCatalogs().subscribe({
      error: (err) => console.error('Error cargando catálogos:', err),
    });

    this.loadContracts();
  }

  loadContracts() {
    const user = this.currentUser();
    if (!user) return;

    this.contractsService.findAll().subscribe({
      next: (contracts) => {
        let finalContracts = contracts;

        if (contracts.length === 0) {
          finalContracts = [
            {
              id: 'none',
              name: 'Sin Contratos Creados',
              code: 'WARN',
              isActive: false, // Requerido por la interfaz
            },
          ];
        }

        if (user.role === 'ADMIN' || user.allowedContracts?.includes('ALL')) {
          this.availableContracts.set(finalContracts);
        } else {
          const filtered = finalContracts.filter((c) =>
            user.allowedContracts?.includes(c.id),
          );
          this.availableContracts.set(filtered);
        }
      },
      error: (err) => {
        console.error('Error obteniendo contratos:', err);
        this.availableContracts.set([
          {
            id: 'err',
            name: 'Error al cargar contratos',
            code: 'ERR',
            isActive: false,
          },
        ]);
      },
    });
  }

  toggleContractDropdown() {
    this.isContractDropdownOpen.update((v) => !v);
  }

  selectContract(contractId: string) {
    this.authService.setCurrentContract(contractId);
    this.isContractDropdownOpen.set(false);
  }

  getCurrentContractName(): string {
    const contractId = this.currentContractId();
    if (contractId === 'ALL') return 'Todos los Contratos';
    const contract = this.availableContracts().find((c) => c.id === contractId);
    return contract ? contract.name : 'Configurando...';
  }
}
