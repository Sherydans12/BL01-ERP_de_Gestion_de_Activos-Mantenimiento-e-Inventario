import {
  Component,
  inject,
  OnInit,
  PLATFORM_ID,
  signal,
  computed,
  effect,
} from '@angular/core';
import { isPlatformBrowser, NgClass } from '@angular/common';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { TenantService } from '../services/tenant/tenant.service';
import { CatalogService } from '../services/catalog/catalog.service';
import { AuthService } from '../services/auth/auth.service';
import { ThemeService } from '../services/theme/theme.service';
import { ContractsService } from '../services/contracts/contracts.service';
import { PushNotificationsService } from '../services/push-notifications/push-notifications.service';
import { Contract } from '../models/types';
import { NAV_SECTIONS, AppRole } from '../navigation/nav.config';

@Component({
  selector: 'app-layout',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, NgClass],
  templateUrl: './layout.component.html',
})
export class LayoutComponent implements OnInit {
  private platformId = inject(PLATFORM_ID);

  tenantService = inject(TenantService);
  catalogService = inject(CatalogService);
  authService = inject(AuthService);
  themeService = inject(ThemeService);
  contractsService = inject(ContractsService);
  private pushNotifications = inject(PushNotificationsService);

  currentTenant = this.tenantService.currentTenant;
  currentUser = this.authService.currentUser;
  currentContractId = this.authService.currentContractId;

  availableContracts = signal<Contract[]>([]);
  isContractDropdownOpen = signal(false);
  isMobileMenuOpen = signal(false);
  /** Notificación push bloqueada en el navegador (aviso en perfil lateral). */
  pushNotificationsBlocked = signal(false);

  filteredNav = computed(() => {
    const user = this.currentUser();
    const role = user?.role as AppRole | undefined;

    // SUPER_ADMIN siempre ve todo.
    if (role === 'SUPER_ADMIN') {
      return NAV_SECTIONS.map((s) => ({ ...s, visibleItems: s.items }));
    }

    // 1. Rol custom asignado al usuario → usa sus rutas específicas.
    if (user?.customRoleId) {
      const customRole = this.currentTenant()?.tenantRoles?.find(
        (r) => r.id === user.customRoleId,
      );
      if (customRole) {
        const allowed = new Set(customRole.routes as string[]);
        return NAV_SECTIONS.map((section) => ({
          ...section,
          visibleItems: section.items.filter((item) => allowed.has(item.route)),
        })).filter((s) => s.visibleItems.length > 0);
      }
    }

    // 2. Permisos configurados por rol base (sidebarPermissions del tenant).
    const customPerms = this.currentTenant()?.sidebarPermissions;
    if (customPerms && role && customPerms[role]) {
      const allowed = new Set(customPerms[role]);
      return NAV_SECTIONS.map((section) => ({
        ...section,
        visibleItems: section.items.filter((item) => allowed.has(item.route)),
      })).filter((s) => s.visibleItems.length > 0);
    }

    // 3. Fallback: defaults de nav.config.ts.
    return NAV_SECTIONS.map((section) => ({
      ...section,
      visibleItems: section.items.filter(
        (item) => !item.roles || !role || item.roles.includes(role),
      ),
    })).filter(
      (section) =>
        section.visibleItems.length > 0 &&
        (!section.roles || !role || section.roles.includes(role)),
    );
  });

  logout() {
    this.authService.logout();
  }

  /** Debug: reintenta registrar la suscripción push (mismo flujo que el auto-registro). */
  debugTryPushSubscribe() {
    this.pushNotifications.debugRetrySubscribe();
  }

  constructor() {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    effect(() => {
      const user = this.authService.currentUser();
      if (!user || !PushNotificationsService.isApproverRole(user.role)) {
        return;
      }
      queueMicrotask(() => this.pushNotifications.maybeSubscribeOncePerSession());
    });
  }

  ngOnInit() {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    this.pushNotificationsBlocked.set(PushNotificationsService.notificationsDenied());

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
              isActive: false,
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
