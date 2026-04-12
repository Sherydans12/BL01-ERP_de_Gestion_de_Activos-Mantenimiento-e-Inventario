import { Component, signal, inject, OnInit, effect, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import {
  PurchasesService,
  PurchaseSettings,
} from '../../../core/services/purchases/purchases.service';
import { NotificationService } from '../../../core/services/notification/notification.service';
import { TenantRolesService, TenantRole } from '../../../core/services/tenant-roles/tenant-roles.service';
import { TenantService } from '../../../core/services/tenant/tenant.service';
import { PushNotificationsService } from '../../../core/services/push-notifications/push-notifications.service';
import { ClpCurrencyPipe } from '../../../shared/pipes/clp-currency.pipe';

function mapTenantConfigRoles(
  rows: Array<{
    id: string;
    name: string;
    description?: string | null;
    baseRole: string;
    routes: string[];
  }>,
): TenantRole[] {
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description ?? undefined,
    baseRole: r.baseRole as TenantRole['baseRole'],
    routes: r.routes,
  }));
}

@Component({
  selector: 'app-purchase-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, ClpCurrencyPipe],
  templateUrl: './purchase-settings.component.html',
})
export class PurchaseSettingsComponent implements OnInit {
  private purchasesService = inject(PurchasesService);
  private rolesService = inject(TenantRolesService);
  private tenantService = inject(TenantService);
  private notify = inject(NotificationService);

  settings = signal<PurchaseSettings | null>(null);
  roles = signal<TenantRole[]>([]);
  isLoading = signal(true);
  isLoadingRoles = signal(false);
  isSeedingDefaults = signal(false);
  isSaving = signal(false);
  /** Aviso cuando el navegador bloqueó notificaciones del sitio. */
  pushNotificationsBlocked = signal(false);

  threshold = signal(0);
  currency = signal('CLP');
  policies = signal<Array<{
    level: number;
    description: string;
    roleId: string;
    minAmount: number;
  }>>([]);

  readonly maxLevels = 3;

  /** Índices reales en `policies()` para filas de nivel 1–2. */
  policyRowsBase = computed(() =>
    this.policies()
      .map((policy, index) => ({ policy, index }))
      .filter((x) => x.policy.level <= 2),
  );

  /** Nivel 3 (condicional al umbral en backend). */
  policyRowsCritical = computed(() =>
    this.policies()
      .map((policy, index) => ({ policy, index }))
      .filter((x) => x.policy.level === 3),
  );

  canSaveMatrix = computed(() => this.policies().length >= 2);

  constructor() {
    effect(() => {
      const tr = this.tenantService.currentTenant()?.tenantRoles;
      if (!tr?.length || this.roles().length > 0) return;
      this.roles.set(mapTenantConfigRoles(tr));
    });
  }

  ngOnInit() {
    this.pushNotificationsBlocked.set(PushNotificationsService.notificationsDenied());
    const cached = this.tenantService.currentTenant()?.tenantRoles;
    if (cached?.length) {
      this.roles.set(mapTenantConfigRoles(cached));
    }
    this.loadSettings();
    this.loadRoles();
  }

  loadSettings() {
    this.isLoading.set(true);
    this.purchasesService.getSettings().subscribe({
      next: (data) => {
        this.settings.set(data);
        this.threshold.set(Number(data.approvalThreshold));
        this.currency.set(data.currency);
        this.policies.set(
          data.approvalPolicies.map((p) => ({
            level: p.level,
            description: p.description || '',
            roleId: p.roleId,
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

  loadDefaultRoles() {
    this.isSeedingDefaults.set(true);
    this.rolesService.ensureDefaultRoles().subscribe({
      next: (data) => {
        this.roles.set(data);
        this.tenantService.getTenantConfig().subscribe({
          next: (cfg) => this.tenantService.setTenant(cfg),
        });
        this.notify.success('Roles base disponibles en la lista');
        this.isSeedingDefaults.set(false);
      },
      error: () => {
        this.notify.error('No se pudieron generar los roles base');
        this.isSeedingDefaults.set(false);
      },
    });
  }

  loadRoles() {
    this.isLoadingRoles.set(true);
    this.rolesService.getAll().subscribe({
      next: (data) => {
        if (data.length > 0) {
          this.roles.set(data);
        } else {
          this.applyRolesFromTenantCache();
        }
        this.isLoadingRoles.set(false);
      },
      error: (err) => {
        const msg = err?.error?.message;
        this.notify.error(
          typeof msg === 'string'
            ? msg
            : 'No se pudieron cargar los roles personalizados del tenant',
        );
        this.applyRolesFromTenantCache();
        this.isLoadingRoles.set(false);
      },
    });
  }

  private applyRolesFromTenantCache() {
    const tr = this.tenantService.currentTenant()?.tenantRoles;
    if (tr?.length) {
      this.roles.set(mapTenantConfigRoles(tr));
    }
  }

  addPolicy() {
    if (this.policies().length >= this.maxLevels) {
      this.notify.warning(
        'BaseLogic actualmente soporta hasta 3 niveles de escalamiento (Base + Crítico).',
      );
      return;
    }
    const nextLevel = this.policies().length + 1;
    this.policies.update((p) => [
      ...p,
      { level: nextLevel, description: '', roleId: '', minAmount: 0 },
    ]);
  }

  removePolicy(index: number) {
    this.policies.update((p) =>
      p.filter((_, i) => i !== index).map((item, i) => ({ ...item, level: i + 1 })),
    );
  }

  updatePolicy(index: number, field: string, value: any) {
    this.policies.update((p) =>
      p.map((item, i) => (i === index ? { ...item, [field]: value } : item)),
    );
  }

  saveSettings() {
    this.isSaving.set(true);
    this.purchasesService
      .updateSettings({ approvalThreshold: this.threshold(), currency: this.currency() })
      .subscribe({
        next: () => this.notify.success('Configuración guardada'),
        error: () => this.notify.error('Error al guardar configuración'),
      });
  }

  savePolicies() {
    if (this.policies().length < 2) {
      this.notify.error('Debe configurar al menos 2 niveles de firma.');
      return;
    }
    if (this.policies().some((p) => !p.roleId)) {
      this.notify.error('Todos los niveles deben tener un rol asignado');
      return;
    }
    this.isSaving.set(true);
    this.purchasesService.upsertPolicies(this.policies()).subscribe({
      next: () => {
        this.notify.success('Políticas de aprobación guardadas');
        this.isSaving.set(false);
      },
      error: () => {
        this.notify.error('Error al guardar políticas');
        this.isSaving.set(false);
      },
    });
  }

  save() {
    if (this.policies().length < 2) {
      this.notify.error('Debe configurar al menos 2 niveles de firma.');
      return;
    }
    this.saveSettings();
    this.savePolicies();
  }
}
