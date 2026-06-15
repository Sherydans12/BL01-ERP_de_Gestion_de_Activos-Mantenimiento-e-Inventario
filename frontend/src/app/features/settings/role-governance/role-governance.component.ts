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
import { AuthService } from '../../../core/services/auth/auth.service';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { A } from '../../../core/constants/admin-permissions';
import type {
  PermissionCatalogGroup,
  PermissionCatalogModule,
} from '../../../core/models/permissions-catalog.interface';

const SYSTEM_MIRROR_PREFIX = 'Sistema ·';

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

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly creating = signal(false);
  readonly deleting = signal(false);
  readonly showCreateModal = signal(false);
  readonly showDeleteModal = signal(false);

  readonly roles = signal<TenantRole[]>([]);
  readonly catalog = signal<PermissionCatalogModule[]>([]);
  readonly selectedRole = signal<TenantRole | null>(null);
  readonly draftPermissions = signal<Set<string>>(new Set());
  readonly expandedModules = signal<Set<string>>(new Set());
  readonly replacementRoleId = signal('');

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

  readonly totalCatalogPermissions = computed(() => {
    let n = 0;
    for (const mod of this.catalog()) {
      for (const g of mod.groups) {
        n += g.permissions.length;
      }
    }
    return n;
  });

  readonly selectedRoleAssignedUsersCount = computed(
    () => this.selectedRole()?._count?.users ?? 0,
  );

  readonly replacementCandidates = computed(() => {
    const role = this.selectedRole();
    if (!role) return [] as TenantRole[];

    return this.roles()
      .filter((candidate) => {
        if (candidate.id === role.id) return false;
        return candidate.baseRole === role.baseRole;
      })
      .sort((a, b) => {
        const aMirror = a.name.startsWith(SYSTEM_MIRROR_PREFIX) ? 0 : 1;
        const bMirror = b.name.startsWith(SYSTEM_MIRROR_PREFIX) ? 0 : 1;
        if (aMirror !== bMirror) return aMirror - bMirror;
        return a.name.localeCompare(b.name);
      });
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
            'Permisos guardados. El menú lateral se deriva de estos permisos: el usuario debe cerrar sesión y volver a entrar.',
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

  openDeleteModal(): void {
    const role = this.selectedRole();
    if (!role || this.deleting()) return;

    const firstCandidate = this.replacementCandidates()[0];
    this.replacementRoleId.set(firstCandidate?.id ?? '');
    this.showDeleteModal.set(true);
  }

  closeDeleteModal(): void {
    this.showDeleteModal.set(false);
    this.replacementRoleId.set('');
  }

  confirmDeleteRole(): void {
    const role = this.selectedRole();
    if (!role || this.deleting()) return;

    const assignedUsers = this.selectedRoleAssignedUsersCount();
    const replacementRoleId = this.replacementRoleId().trim();
    if (assignedUsers > 0 && !replacementRoleId) {
      this.notif.error(
        'Seleccione un rol de reemplazo del mismo nivel antes de eliminar.',
      );
      return;
    }

    const payload =
      assignedUsers > 0 ? { replacementRoleId: replacementRoleId } : undefined;

    this.deleting.set(true);
    this.tenantRoles
      .remove(role.id, payload)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.deleting.set(false);
          this.closeDeleteModal();
          this.selectedRole.set(null);
          this.draftPermissions.set(new Set());
          this.notif.success(res.message || 'Rol eliminado correctamente.');
          this.load();
        },
        error: (err) => {
          this.deleting.set(false);
          const msg = err?.error?.message ?? 'No se pudo eliminar el rol.';
          this.notif.error(Array.isArray(msg) ? msg.join(', ') : msg);
        },
      });
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
          this.notif.success(
            'Rol creado. Asigna permisos PBAC; el menú se mostrará según los permisos de lectura de cada módulo.',
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
