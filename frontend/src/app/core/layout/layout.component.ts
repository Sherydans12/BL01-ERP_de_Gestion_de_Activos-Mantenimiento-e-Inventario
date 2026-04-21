import {
  Component,
  inject,
  OnInit,
  PLATFORM_ID,
  signal,
  computed,
  effect,
  HostListener,
  viewChild,
  ElementRef,
} from '@angular/core';
import { isPlatformBrowser, NgClass } from '@angular/common';
import {
  RouterOutlet,
  RouterLink,
  RouterLinkActive,
  Router,
  NavigationEnd,
} from '@angular/router';
import { Title } from '@angular/platform-browser';
import { filter } from 'rxjs/operators';
import { TenantService } from '../services/tenant/tenant.service';
import { CatalogService } from '../services/catalog/catalog.service';
import { AuthService } from '../services/auth/auth.service';
import { ThemeService } from '../services/theme/theme.service';
import { ContractsService } from '../services/contracts/contracts.service';
import { PushNotificationsService } from '../services/push-notifications/push-notifications.service';
import { Contract } from '../models/types';
import { NAV_SECTIONS, AppRole } from '../navigation/nav.config';
import {
  GlobalSearchResult,
  InventoryAnalyticsService,
} from '../services/inventory-analytics/inventory-analytics.service';
import { QuickViewService } from '../../shared/components/quick-view/quick-view.service';
import { AvatarComponent } from '../../shared/components/avatar/avatar.component';

@Component({
  selector: 'app-layout',
  standalone: true,
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    NgClass,
    AvatarComponent,
  ],
  templateUrl: './layout.component.html',
})
export class LayoutComponent implements OnInit {
  private platformId = inject(PLATFORM_ID);
  private title = inject(Title);
  private router = inject(Router);

  tenantService = inject(TenantService);
  catalogService = inject(CatalogService);
  authService = inject(AuthService);
  themeService = inject(ThemeService);
  contractsService = inject(ContractsService);
  private pushNotifications = inject(PushNotificationsService);
  private inventoryAnalytics = inject(InventoryAnalyticsService);
  private quickView = inject(QuickViewService);

  currentTenant = this.tenantService.currentTenant;
  currentUser = this.authService.currentUser;
  currentContractId = this.authService.currentContractId;

  availableContracts = signal<Contract[]>([]);
  isContractDropdownOpen = signal(false);
  isMobileMenuOpen = signal(false);
  /** Notificación push bloqueada en el navegador (aviso en perfil lateral). */
  pushNotificationsBlocked = signal(false);
  commandPaletteOpen = signal(false);
  commandQuery = signal('');
  commandResults = signal<GlobalSearchResult[]>([]);
  commandLoading = signal(false);
  private commandSearchDebounce: ReturnType<typeof setTimeout> | null = null;

  /** Menú contextual del usuario (esquina inferior del sidebar). */
  profileMenuOpen = signal(false);
  profileMenuRoot = viewChild<ElementRef<HTMLElement>>('profileMenuRoot');

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
    this.profileMenuOpen.set(false);
    this.authService.logout();
  }

  toggleProfileMenu(ev: Event) {
    ev.stopPropagation();
    this.profileMenuOpen.update((v) => !v);
  }

  closeProfileMenu() {
    this.profileMenuOpen.set(false);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(ev: MouseEvent) {
    if (!this.profileMenuOpen()) return;
    const root = this.profileMenuRoot()?.nativeElement;
    if (root && !root.contains(ev.target as Node)) {
      this.profileMenuOpen.set(false);
    }
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

    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe(() => {
        let r = this.router.routerState.root;
        while (r.firstChild) {
          r = r.firstChild;
        }
        const pt = r.snapshot.data['pageTitle'];
        if (typeof pt === 'string' && pt.length > 0) {
          this.title.setTitle(`${pt} | BaseLogic`);
        } else {
          this.title.setTitle('BaseLogic');
        }
      });
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

  @HostListener('window:keydown', ['$event'])
  onWindowKeydown(ev: KeyboardEvent) {
    const key = ev.key.toLowerCase();
    if ((ev.ctrlKey || ev.metaKey) && key === 'k') {
      ev.preventDefault();
      this.openCommandPalette();
    }
    if (key === 'escape' && this.commandPaletteOpen()) {
      this.closeCommandPalette();
    }
  }

  openCommandPalette() {
    this.commandPaletteOpen.set(true);
    this.commandQuery.set('');
    this.commandResults.set([]);
  }

  closeCommandPalette() {
    this.commandPaletteOpen.set(false);
    this.commandLoading.set(false);
    if (this.commandSearchDebounce) {
      clearTimeout(this.commandSearchDebounce);
      this.commandSearchDebounce = null;
    }
  }

  onCommandQueryChange(value: string) {
    this.commandQuery.set(value);
    const q = value.trim();
    if (this.commandSearchDebounce) {
      clearTimeout(this.commandSearchDebounce);
      this.commandSearchDebounce = null;
    }
    if (!q) {
      this.commandResults.set([]);
      this.commandLoading.set(false);
      return;
    }
    this.commandSearchDebounce = setTimeout(() => {
      this.commandLoading.set(true);
      this.inventoryAnalytics.globalSearch(q).subscribe({
        next: (resp) => {
          this.commandResults.set(resp.results);
          this.commandLoading.set(false);
        },
        error: () => {
          this.commandResults.set([]);
          this.commandLoading.set(false);
        },
      });
    }, 180);
  }

  openCommandResult(row: GlobalSearchResult) {
    if (
      row.kind === 'REQ' ||
      row.kind === 'PO' ||
      row.kind === 'INV' ||
      row.kind === 'WR'
    ) {
      this.quickView.open(row.kind, row.id);
      this.closeCommandPalette();
      return;
    }
    if (row.kind === 'OT') {
      this.router.navigate(['/app/ots', row.id]);
      this.closeCommandPalette();
      return;
    }
    if (row.kind === 'ITEM') {
      this.router.navigate(['/app/articulos', row.id]);
      this.closeCommandPalette();
      return;
    }
    if (row.kind === 'WH') {
      this.router.navigate(['/app/inventario/bodegas', row.id]);
      this.closeCommandPalette();
      return;
    }
    if (row.kind === 'EQUIP') {
      this.quickView.open('EQUIP', row.id);
      this.closeCommandPalette();
      return;
    }
    this.closeCommandPalette();
  }

  commandKindLabel(kind: GlobalSearchResult['kind']): string {
    if (kind === 'REQ') return 'Requerimiento';
    if (kind === 'PO') return 'Orden de compra';
    if (kind === 'INV') return 'Factura';
    if (kind === 'WR') return 'Recepción';
    if (kind === 'OT') return 'OT';
    if (kind === 'EQUIP') return 'Equipo';
    if (kind === 'ITEM') return 'Repuesto';
    if (kind === 'WH') return 'Bodega';
    return kind;
  }

  commandKindIcon(kind: GlobalSearchResult['kind']): string {
    if (kind === 'REQ')
      return 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z';
    if (kind === 'PO')
      return 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2';
    if (kind === 'INV')
      return 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z';
    if (kind === 'WR')
      return 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10';
    if (kind === 'OT')
      return 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 012-2h2a2 2 0 012 2';
    if (kind === 'EQUIP')
      return 'M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0zM13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1';
    if (kind === 'ITEM')
      return 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10';
    return 'M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8';
  }
}
