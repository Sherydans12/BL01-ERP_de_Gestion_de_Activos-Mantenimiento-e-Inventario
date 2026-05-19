import {
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule, NgClass } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
import {
  TenantRolesService,
  TenantRole,
  CreateTenantRolePayload,
} from '../../../core/services/tenant-roles/tenant-roles.service';
import { NotificationService } from '../../../core/services/notification/notification.service';
import { NAV_SECTIONS } from '../../../core/navigation/nav.config';
import { AuthService } from '../../../core/services/auth/auth.service';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { A } from '../../../core/constants/admin-permissions';
import type {
  PermissionCatalogGroup,
  PermissionCatalogModule,
} from '../../../core/models/permissions-catalog.interface';

const SYSTEM_MIRROR_PREFIX = 'Sistema ·';

type DetailTab = 'menu' | 'pbac';

function normalizePermissions(role: TenantRole | null): string[] {
  if (!role?.permissions) return [];
  return Array.isArray(role.permissions)
    ? role.permissions.filter((p): p is string => typeof p === 'string')
    : [];
}

@Component({
  selector: 'app-role-governance',
  standalone: true,
  imports: [CommonModule, FormsModule, NgClass, HasPermissionDirective],
  templateUrl: './role-governance.component.html',
})
export class RoleGovernanceComponent implements OnInit {
  private readonly tenantRoles = inject(TenantRolesService);
  private readonly notif = inject(NotificationService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly authService = inject(AuthService);

  readonly a = A;
  readonly canManageRoles = computed(() =>
    this.authService.hasPermission(A.USER_MANAGE_ROLES),
  );

  readonly navSections = NAV_SECTIONS;

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly savingRoutes = signal(false);
  readonly creating = signal(false);
  readonly showCreateModal = signal(false);

  readonly roles = signal<TenantRole[]>([]);
  readonly catalog = signal<PermissionCatalogModule[]>([]);
  readonly selectedRole = signal<TenantRole | null>(null);
  readonly draftPermissions = signal<Set<string>>(new Set());
  readonly draftRoutes = signal<Set<string>>(new Set());
  readonly expandedModules = signal<Set<string>>(new Set());
  readonly detailTab = signal<DetailTab>('menu');

  readonly customRoles = computed(() =>
    this.roles().filter((r) => !r.name.startsWith(SYSTEM_MIRROR_PREFIX)),
  );

  readonly isAdminBaseBypass = computed(
    () => this.selectedRole()?.baseRole === 'ADMIN',
  );

  readonly selectedCount = computed(() => {
    if (this.isAdminBaseBypass()) {
      return this.totalCatalogPermissions();
    }
    return this.draftPermissions().size;
  });

  readonly routesSelectedCount = computed(() => this.draftRoutes().size);

  readonly totalNavRoutes = computed(() => {
    let n = 0;
    for (const section of this.navSections) {
      n += section.items.length;
    }
    return n;
  });

  readonly totalCatalogPermissions = computed(() => {
    let n = 0;
    for (const mod of this.catalog()) {
      for (const g of mod.groups) {
        n += g.permissions.length;
      }
    }
    return n;
  });

  createForm = {
    name: '',
    description: '',
    baseRole: 'USER' as CreateTenantRolePayload['baseRole'],
  };

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    forkJoin({
      roles: this.tenantRoles.getAll(),
      catalog: this.tenantRoles.getPermissionsCatalog(),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ roles, catalog }) => {
          const parsed = roles.map((r) => ({
            ...r,
            permissions: normalizePermissions(r),
          }));
          this.roles.set(parsed);
          this.catalog.set(catalog);
          if (catalog.length > 0) {
            this.expandedModules.set(new Set([catalog[0].module]));
          }
          const current = this.selectedRole();
          if (current) {
            const refreshed = parsed.find((r) => r.id === current.id);
            if (refreshed) {
              this.selectRole(refreshed);
            } else {
              this.selectedRole.set(null);
              this.draftPermissions.set(new Set());
              this.draftRoutes.set(new Set());
            }
          }
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
          this.notif.error('No se pudo cargar roles o catálogo de permisos.');
        },
      });
  }

  selectRole(role: TenantRole): void {
    this.selectedRole.set(role);
    this.draftPermissions.set(new Set(normalizePermissions(role)));
    this.draftRoutes.set(new Set(role.routes ?? []));
  }

  setDetailTab(tab: DetailTab): void {
    this.detailTab.set(tab);
  }

  detailTabClasses(tab: DetailTab): string {
    return this.detailTab() === tab
      ? 'border-primary text-primary'
      : 'border-transparent text-muted hover:text-main';
  }

  isRouteEnabled(route: string): boolean {
    return this.draftRoutes().has(route);
  }

  toggleRoute(route: string): void {
    this.draftRoutes.update((set) => {
      const next = new Set(set);
      if (next.has(route)) {
        next.delete(route);
      } else {
        next.add(route);
      }
      return next;
    });
  }

  selectAllRoutes(): void {
    const all = new Set<string>();
    for (const section of this.navSections) {
      for (const item of section.items) {
        all.add(item.route);
      }
    }
    this.draftRoutes.set(all);
  }

  clearAllRoutes(): void {
    this.draftRoutes.set(new Set());
  }

  sectionRoutesSelectedCount(sectionLabel: string): number {
    const section = this.navSections.find((s) => s.label === sectionLabel);
    if (!section) return 0;
    const draft = this.draftRoutes();
    return section.items.filter((i) => draft.has(i.route)).length;
  }

  selectAllRoutesInSection(sectionLabel: string): void {
    const section = this.navSections.find((s) => s.label === sectionLabel);
    if (!section) return;
    this.draftRoutes.update((set) => {
      const next = new Set(set);
      for (const item of section.items) {
        next.add(item.route);
      }
      return next;
    });
  }

  clearRoutesInSection(sectionLabel: string): void {
    const section = this.navSections.find((s) => s.label === sectionLabel);
    if (!section) return;
    this.draftRoutes.update((set) => {
      const next = new Set(set);
      for (const item of section.items) {
        next.delete(item.route);
      }
      return next;
    });
  }

  saveRoutes(): void {
    const role = this.selectedRole();
    if (!role || this.savingRoutes()) return;

    this.savingRoutes.set(true);
    const routes = Array.from(this.draftRoutes()).sort();

    this.tenantRoles
      .update(role.id, { routes })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (updated) => {
          const merged = {
            ...updated,
            permissions: normalizePermissions(updated),
          };
          this.roles.update((list) =>
            list.map((r) => (r.id === merged.id ? merged : r)),
          );
          this.selectedRole.set(merged);
          this.draftRoutes.set(new Set(merged.routes ?? []));
          this.savingRoutes.set(false);
          this.notif.success(
            'Accesos de menú guardados. El usuario debe iniciar sesión de nuevo para ver el menú actualizado.',
          );
        },
        error: (err) => {
          this.savingRoutes.set(false);
          const msg = err?.error?.message ?? 'Error al guardar accesos de menú.';
          this.notif.error(Array.isArray(msg) ? msg.join(', ') : msg);
        },
      });
  }

  isModuleExpanded(module: string): boolean {
    return this.expandedModules().has(module);
  }

  toggleModule(module: string): void {
    this.expandedModules.update((set) => {
      const next = new Set(set);
      if (next.has(module)) {
        next.delete(module);
      } else {
        next.add(module);
      }
      return next;
    });
  }

  isPermissionEnabled(key: string): boolean {
    if (this.isAdminBaseBypass()) return true;
    return this.draftPermissions().has(key);
  }

  isPermissionDisabled(): boolean {
    return this.isAdminBaseBypass();
  }

  togglePermission(key: string): void {
    if (this.isAdminBaseBypass()) return;
    this.draftPermissions.update((set) => {
      const next = new Set(set);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  enableAllInGroup(group: PermissionCatalogGroup): void {
    if (this.isAdminBaseBypass()) return;
    this.draftPermissions.update((set) => {
      const next = new Set(set);
      for (const p of group.permissions) {
        next.add(p.key);
      }
      return next;
    });
  }

  groupEnabledCount(group: PermissionCatalogGroup): number {
    if (this.isAdminBaseBypass()) {
      return group.permissions.length;
    }
    const draft = this.draftPermissions();
    return group.permissions.filter((p) => draft.has(p.key)).length;
  }

  roleListItemClasses(roleId: string): string {
    return this.selectedRole()?.id === roleId
      ? 'border-primary bg-primary/10'
      : 'border-border hover:border-primary/40';
  }

  permissionTileClasses(key: string): string {
    return this.isPermissionEnabled(key)
      ? 'border-primary/50 bg-primary/5'
      : 'border-border';
  }

  savePermissions(): void {
    const role = this.selectedRole();
    if (!role || this.saving() || this.isAdminBaseBypass()) return;

    this.saving.set(true);
    const permissions = Array.from(this.draftPermissions()).sort();

    this.tenantRoles
      .update(role.id, { permissions })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (updated) => {
          const withPerms = {
            ...updated,
            permissions: normalizePermissions(updated),
          };
          this.roles.update((list) =>
            list.map((r) => (r.id === withPerms.id ? withPerms : r)),
          );
          this.selectedRole.set(withPerms);
          this.draftPermissions.set(new Set(withPerms.permissions ?? []));
          this.saving.set(false);
          this.notif.success(
            'Los permisos se han guardado correctamente. Si el usuario está activo, deberá cerrar e iniciar sesión para que los cambios surtan efecto.',
          );
        },
        error: (err) => {
          this.saving.set(false);
          const msg = err?.error?.message ?? 'Error al guardar permisos.';
          this.notif.error(Array.isArray(msg) ? msg.join(', ') : msg);
        },
      });
  }

  openCreateModal(): void {
    this.createForm = {
      name: '',
      description: '',
      baseRole: 'USER',
    };
    this.showCreateModal.set(true);
  }

  closeCreateModal(): void {
    this.showCreateModal.set(false);
  }

  submitCreateRole(): void {
    const name = this.createForm.name.trim();
    if (!name || this.creating()) return;

    this.creating.set(true);
    const payload: CreateTenantRolePayload = {
      name,
      description: this.createForm.description.trim() || undefined,
      baseRole: this.createForm.baseRole,
      routes: [],
      permissions: [],
    };

    this.tenantRoles
      .create(payload)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (created) => {
          const withPerms = {
            ...created,
            permissions: normalizePermissions(created),
          };
          this.roles.update((list) => [...list, withPerms]);
          this.creating.set(false);
          this.showCreateModal.set(false);
          this.selectRole(withPerms);
          this.detailTab.set('menu');
          this.notif.success(
            'Rol creado. Configura accesos de menú y permisos PBAC en el panel derecho.',
          );
        },
        error: (err) => {
          this.creating.set(false);
          const msg = err?.error?.message ?? 'No se pudo crear el rol.';
          this.notif.error(Array.isArray(msg) ? msg.join(', ') : msg);
        },
      });
  }
}
