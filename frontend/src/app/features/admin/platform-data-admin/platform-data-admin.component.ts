import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { NotificationService } from '../../../core/services/notification/notification.service';

export interface PlatformTenantRow {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}

export interface TenantDataSummaryDto {
  tenantId: string;
  code: string;
  name: string;
  purchases: {
    purchaseDocuments: number;
    purchaseInvoices: number;
    warehouseReceipts: number;
    purchaseOrders: number;
    purchaseQuotations: number;
    purchaseRequisitions: number;
    vendors: number;
    approvalPolicies: number;
  };
  inventory: {
    inventoryTransactions: number;
    inventoryTransfers: number;
    stockReservations: number;
    inventoryItems: number;
    warehouses: number;
    itemCategories: number;
    unitOfMeasures: number;
  };
  operations: {
    workOrders: number;
    maintenanceKits: number;
    catalogItems: number;
    equipments: number;
    contracts: number;
    subcontracts: number;
  };
  platform: {
    activityLogs: number;
    pushSubscriptions: number;
  };
}

export type PurgeDomain =
  | 'purchases'
  | 'inventory-warehouses'
  | 'work-orders'
  | 'maintenance-kits'
  | 'catalog-items'
  | 'fleet-equipment'
  | 'activity-logs'
  | 'push-subscriptions'
  | 'approval-policies'
  | 'inventory-masters';

export interface PurgeResultDto {
  domain: PurgeDomain;
  tenantId: string;
  deleted: Record<string, number>;
}

const PURGE_COPY: Record<
  PurgeDomain,
  { title: string; hint: string }
> = {
  purchases: {
    title: 'Confirmar purga de compras',
    hint: 'Elimina P2P completo (REQ, cotizaciones, OC, recepciones, facturas, proveedores, documentos adjuntos) y contadores SRC/OC/WR. No borra purchase_settings.',
  },
  'inventory-warehouses': {
    title: 'Confirmar purga de inventario y bodegas',
    hint: 'Elimina artículos, stock, movimientos, transferencias, reservas de OT y bodegas. Requiere cero recepciones de compra (purga compras antes si aplica).',
  },
  'work-orders': {
    title: 'Confirmar purga de órdenes de trabajo',
    hint: 'Elimina todas las OT del tenant (tareas, repuestos, sistemas, fluidos, backlog, reservas vinculadas) y costos de activo tipo WORK_ORDER huérfanos.',
  },
  'maintenance-kits': {
    title: 'Confirmar purga de kits de mantenimiento',
    hint: 'Elimina kits PM y sus líneas por empresa.',
  },
  'catalog-items': {
    title: 'Confirmar purga de catálogo maestro (sistemas/fluidos)',
    hint: 'Elimina ítems de catálogo del tenant. Requiere cero OT (deben borrarse primero).',
  },
  'fleet-equipment': {
    title: 'Confirmar purga de flota (equipos)',
    hint: 'Elimina equipos, logs de medidor y ajustes asociados. Requiere cero OT.',
  },
  'activity-logs': {
    title: 'Confirmar vaciado de auditoría de compras',
    hint: 'Elimina registros de activity_logs del tenant (trazabilidad UI de compras).',
  },
  'push-subscriptions': {
    title: 'Confirmar purga de suscripciones push',
    hint: 'Elimina suscripciones web push del tenant (usuarios pueden volver a suscribirse).',
  },
  'approval-policies': {
    title: 'Confirmar purga de políticas de aprobación',
    hint: 'Elimina niveles de aprobación de compras (approval_policies). purchase_settings permanece.',
  },
  'inventory-masters': {
    title: 'Confirmar purga de categorías y unidades de medida',
    hint: 'Elimina categorías de artículo (jerárquico) y UOM. Requiere cero artículos de inventario.',
  },
};

@Component({
  selector: 'app-platform-data-admin',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './platform-data-admin.component.html',
})
export class PlatformDataAdminComponent implements OnInit {
  private http = inject(HttpClient);
  private notify = inject(NotificationService);

  private readonly base = `${environment.apiUrl}/super-admin/platform`;

  readonly purgeGroups: {
    title: string;
    actions: { domain: PurgeDomain; label: string }[];
  }[] = [
    {
      title: 'Compras e inventario',
      actions: [
        { domain: 'purchases', label: 'Módulo compras (P2P)' },
        { domain: 'inventory-warehouses', label: 'Inventario y bodegas' },
        { domain: 'inventory-masters', label: 'Categorías y UOM' },
        { domain: 'approval-policies', label: 'Políticas de aprobación OC' },
      ],
    },
    {
      title: 'Operaciones y flota',
      actions: [
        { domain: 'work-orders', label: 'Órdenes de trabajo' },
        { domain: 'maintenance-kits', label: 'Kits de mantenimiento (PM)' },
        { domain: 'catalog-items', label: 'Catálogo maestro (sistemas/fluidos)' },
        { domain: 'fleet-equipment', label: 'Flota (equipos)' },
      ],
    },
    {
      title: 'Plataforma y auditoría',
      actions: [
        { domain: 'activity-logs', label: 'Logs de actividad (compras)' },
        { domain: 'push-subscriptions', label: 'Suscripciones push' },
      ],
    },
  ];

  loading = signal(true);
  tenants = signal<PlatformTenantRow[]>([]);
  selectedTenantId = signal<string | null>(null);
  summary = signal<TenantDataSummaryDto | null>(null);
  summaryLoading = signal(false);
  purgeModalDomain = signal<PurgeDomain | null>(null);
  confirmCodeInput = signal('');
  purgeSubmitting = signal(false);
  lastPurgeResult = signal<PurgeResultDto | null>(null);

  // --- Modal de creación de Empresa ---
  isCreateModalOpen = signal(false);
  createForm = signal({ code: '', name: '', primaryColor: '#FF3366' });
  createSubmitting = signal(false);

  purgeModalCopy = computed(() => {
    const d = this.purgeModalDomain();
    if (!d) return null;
    return PURGE_COPY[d];
  });

  ngOnInit() {
    void this.loadTenants();
  }

  async loadTenants() {
    this.loading.set(true);
    try {
      const rows = await firstValueFrom(
        this.http.get<PlatformTenantRow[]>(`${this.base}/tenants`),
      );
      this.tenants.set(rows);
    } catch {
      this.notify.error('No se pudo cargar el listado de empresas.');
    } finally {
      this.loading.set(false);
    }
  }

  selectedTenant = () => {
    const id = this.selectedTenantId();
    if (!id) return null;
    return this.tenants().find((t) => t.id === id) ?? null;
  };

  async selectTenant(id: string) {
    this.selectedTenantId.set(id);
    this.summary.set(null);
    this.lastPurgeResult.set(null);
    this.summaryLoading.set(true);
    try {
      const s = await firstValueFrom(
        this.http.get<TenantDataSummaryDto>(
          `${this.base}/tenants/${id}/data-summary`,
        ),
      );
      this.summary.set(s);
    } catch {
      this.notify.error('No se pudo cargar el resumen de datos.');
    } finally {
      this.summaryLoading.set(false);
    }
  }

  openPurgeModal(domain: PurgeDomain) {
    this.purgeModalDomain.set(domain);
    this.confirmCodeInput.set('');
  }

  closePurgeModal() {
    this.purgeModalDomain.set(null);
    this.confirmCodeInput.set('');
  }

  onConfirmInput(ev: Event) {
    const v = (ev.target as HTMLInputElement).value;
    this.confirmCodeInput.set(v);
  }

  async executePurge() {
    const domain = this.purgeModalDomain();
    const tenantId = this.selectedTenantId();
    const tenant = this.selectedTenant();
    if (!domain || !tenantId || !tenant) return;

    const confirmTenantCode = this.confirmCodeInput().trim();
    if (confirmTenantCode !== tenant.code) {
      this.notify.error(
        'El código debe coincidir exactamente con el código de la empresa.',
      );
      return;
    }

    this.purgeSubmitting.set(true);
    try {
      const result = await firstValueFrom(
        this.http.post<PurgeResultDto>(
          `${this.base}/tenants/${tenantId}/purge/${encodeURIComponent(domain)}`,
          { confirmTenantCode },
        ),
      );
      this.lastPurgeResult.set(result);
      this.notify.success('Operación completada.');
      this.closePurgeModal();
      await this.selectTenant(tenantId);
      await this.loadTenants();
    } catch (err: unknown) {
      let msg = 'No se pudo ejecutar la operación.';
      if (err && typeof err === 'object' && 'error' in err) {
        const e = (err as { error: unknown }).error;
        if (typeof e === 'string') {
          msg = e;
        } else if (e && typeof e === 'object' && 'message' in e) {
          const m = (e as { message: unknown }).message;
          if (typeof m === 'string') msg = m;
          else if (Array.isArray(m)) msg = m.join(', ');
        }
      }
      this.notify.error(msg);
    } finally {
      this.purgeSubmitting.set(false);
    }
  }

  // --- Lógica de Creación de Empresa ---
  openCreateModal() {
    this.createForm.set({ code: '', name: '', primaryColor: '#FF3366' });
    this.isCreateModalOpen.set(true);
  }

  closeCreateModal() {
    this.isCreateModalOpen.set(false);
  }

  updateCreateForm(field: 'code' | 'name' | 'primaryColor', value: string) {
    this.createForm.update(f => ({ ...f, [field]: value }));
  }

  async executeCreate() {
    const form = this.createForm();
    if (!form.code.trim() || !form.name.trim()) {
      this.notify.error('El código y el nombre son obligatorios.');
      return;
    }

    this.createSubmitting.set(true);
    try {
      await firstValueFrom(
        this.http.post(`${this.base}/tenants`, form)
      );
      this.notify.success('Empresa creada correctamente.');
      this.closeCreateModal();
      await this.loadTenants();
    } catch (err: unknown) {
      let msg = 'No se pudo crear la empresa.';
      if (err && typeof err === 'object' && 'error' in err) {
        const e = (err as { error: unknown }).error;
        if (typeof e === 'string') {
          msg = e;
        } else if (e && typeof e === 'object' && 'message' in e) {
          const m = (e as { message: unknown }).message;
          if (typeof m === 'string') msg = m;
          else if (Array.isArray(m)) msg = m.join(', ');
        }
      }
      this.notify.error(msg);
    } finally {
      this.createSubmitting.set(false);
    }
  }
}
