import { Component, signal, inject, OnInit, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import {
  PurchasesService,
  PurchaseSettings,
} from '../../../core/services/purchases/purchases.service';
import { NotificationService } from '../../../core/services/notification/notification.service';
import { UsersService, User } from '../../../core/services/users/users.service';
import { PushNotificationsService } from '../../../core/services/push-notifications/push-notifications.service';
import { ClpCurrencyPipe } from '../../../shared/pipes/clp-currency.pipe';
import { switchMap } from 'rxjs/operators';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { P } from '../../../core/constants/purchases-permissions';
import { AuthService } from '../../../core/services/auth/auth.service';

interface PolicyRow {
  level: number;
  description: string;
  userIds: string[];
  minAmount: number;
}

@Component({
  selector: 'app-purchase-settings',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    ClpCurrencyPipe,
    HasPermissionDirective,
  ],
  templateUrl: './purchase-settings.component.html',
})
export class PurchaseSettingsComponent implements OnInit {
  protected readonly p = P;

  private purchasesService = inject(PurchasesService);
  private usersService = inject(UsersService);
  private notify = inject(NotificationService);
  private auth = inject(AuthService);

  /** Sin `SETTING_UPDATE`: formulario y matriz en solo lectura (equivalente a `form.disable()`). */
  readonly isFormReadOnly = computed(
    () => !this.auth.hasPermission(P.SETTING_UPDATE),
  );

  settings = signal<PurchaseSettings | null>(null);
  /** Lista plana de usuarios activos del tenant para el selector. */
  tenantUsers = signal<User[]>([]);
  isLoading = signal(true);
  isLoadingUsers = signal(false);
  isSaving = signal(false);
  /** Aviso cuando el navegador bloqueó notificaciones del sitio. */
  pushNotificationsBlocked = signal(false);

  threshold = signal(0);
  currency = signal('CLP');
  /** Margen relativo (p. ej. 1 = 1%) para validación 3-way match factura vs OC / recepción. */
  invoiceMatchTolerancePercent = signal(1);
  policies = signal<PolicyRow[]>([]);

  /** Texto de búsqueda por nivel para filtrar el listado de usuarios disponibles. */
  userSearch = signal<Record<number, string>>({});

  readonly maxLevels = 3;

  policyRowsBase = computed(() =>
    this.policies()
      .map((policy, index) => ({ policy, index }))
      .filter((x) => x.policy.level <= 2),
  );

  policyRowsCritical = computed(() =>
    this.policies()
      .map((policy, index) => ({ policy, index }))
      .filter((x) => x.policy.level === 3),
  );

  canSaveMatrix = computed(() => this.policies().length >= 2);

  ngOnInit() {
    this.pushNotificationsBlocked.set(PushNotificationsService.notificationsDenied());
    this.loadSettings();
    this.loadTenantUsers();
  }

  loadSettings() {
    this.isLoading.set(true);
    this.purchasesService.getSettings().subscribe({
      next: (data) => {
        this.settings.set(data);
        this.threshold.set(Number(data.approvalThreshold));
        this.currency.set(data.currency);
        this.invoiceMatchTolerancePercent.set(Number(data.invoiceMatchTolerancePercent ?? 1));
        this.policies.set(
          data.approvalPolicies.map((p) => ({
            level: p.level,
            description: p.description || '',
            userIds: p.allowedUsers.map((au) => au.userId),
            minAmount: Number(p.minAmount),
          })),
        );
        this.isLoading.set(false);
      },
      error: () => {
        this.notify.error('Error al cargar configuración');
        this.isLoading.set(false);
      },
    });
  }

  loadTenantUsers() {
    this.isLoadingUsers.set(true);
    this.usersService.getUsers(1, 200).subscribe({
      next: (data) => {
        this.tenantUsers.set(data.items.filter((u) => u.isActive));
        this.isLoadingUsers.set(false);
      },
      error: () => {
        this.notify.error('No se pudieron cargar los usuarios del tenant');
        this.isLoadingUsers.set(false);
      },
    });
  }

  /** Usuarios disponibles para un nivel (excluye los ya asignados a ese nivel, filtrando por búsqueda). */
  availableUsersForLevel(levelIndex: number): User[] {
    const policy = this.policies()[levelIndex];
    if (!policy) return [];
    const q = (this.userSearch()[policy.level] ?? '').toLowerCase();
    return this.tenantUsers().filter((u) => {
      if (policy.userIds.includes(u.id)) return false;
      if (!q) return true;
      return (
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        (u.position ?? '').toLowerCase().includes(q)
      );
    });
  }

  /** Usuarios asignados a un nivel, enriquecidos con datos de perfil. */
  assignedUsersForLevel(levelIndex: number): User[] {
    const policy = this.policies()[levelIndex];
    if (!policy) return [];
    return this.tenantUsers().filter((u) => policy.userIds.includes(u.id));
  }

  addUserToPolicy(levelIndex: number, userId: string) {
    if (this.isFormReadOnly()) return;
    this.policies.update((ps) =>
      ps.map((p, i) =>
        i === levelIndex && !p.userIds.includes(userId)
          ? { ...p, userIds: [...p.userIds, userId] }
          : p,
      ),
    );
    // limpiar búsqueda del nivel
    const level = this.policies()[levelIndex]?.level;
    if (level !== undefined) {
      this.userSearch.update((s) => ({ ...s, [level]: '' }));
    }
  }

  removeUserFromPolicy(levelIndex: number, userId: string) {
    if (this.isFormReadOnly()) return;
    this.policies.update((ps) =>
      ps.map((p, i) =>
        i === levelIndex ? { ...p, userIds: p.userIds.filter((id) => id !== userId) } : p,
      ),
    );
  }

  setUserSearch(level: number, value: string) {
    if (this.isFormReadOnly()) return;
    this.userSearch.update((s) => ({ ...s, [level]: value }));
  }

  addPolicy() {
    if (this.isFormReadOnly()) return;
    if (this.policies().length >= this.maxLevels) {
      this.notify.warning('BaseLogic soporta hasta 3 niveles de escalamiento (Base + Crítico).');
      return;
    }
    const nextLevel = this.policies().length + 1;
    this.policies.update((p) => [
      ...p,
      { level: nextLevel, description: '', userIds: [], minAmount: 0 },
    ]);
  }

  removePolicy(index: number) {
    if (this.isFormReadOnly()) return;
    this.policies.update((p) =>
      p.filter((_, i) => i !== index).map((item, i) => ({ ...item, level: i + 1 })),
    );
  }

  updatePolicyField(index: number, field: keyof PolicyRow, value: any) {
    if (this.isFormReadOnly()) return;
    this.policies.update((p) =>
      p.map((item, i) => (i === index ? { ...item, [field]: value } : item)),
    );
  }

  save() {
    if (this.isFormReadOnly()) return;
    if (this.policies().length < 2) {
      this.notify.error('Debe configurar al menos 2 niveles de firma.');
      return;
    }
    const emptyLevel = this.policies().find((p) => !p.userIds.length);
    if (emptyLevel) {
      this.notify.warning(`El Nivel ${emptyLevel.level} no tiene usuarios asignados. Asigne al menos un firmante antes de guardar.`);
      return;
    }
    this.isSaving.set(true);
    this.purchasesService
      .updateSettings({
        approvalThreshold: this.threshold(),
        currency: this.currency(),
        invoiceMatchTolerancePercent: this.invoiceMatchTolerancePercent(),
      })
      .pipe(switchMap(() => this.purchasesService.upsertPolicies(this.policies())))
      .subscribe({
        next: () => {
          this.notify.success('Configuración y políticas guardadas');
          this.loadSettings();
          this.isSaving.set(false);
        },
        error: (err) => {
          const msg = err?.error?.message;
          this.notify.error(typeof msg === 'string' ? msg : 'Error al guardar configuración');
          this.isSaving.set(false);
        },
      });
  }
}
