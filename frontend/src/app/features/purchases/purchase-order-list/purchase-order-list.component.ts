import { Component, signal, computed, effect, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { PurchasesService, PurchaseOrder } from '../../../core/services/purchases/purchases.service';
import { NotificationService } from '../../../core/services/notification/notification.service';
import { ClpCurrencyPipe } from '../../../shared/pipes/clp-currency.pipe';
import { PurchasesPushNoticeComponent } from '../../../shared/components/purchases-push-notice/purchases-push-notice.component';
import { EntityLinkComponent } from '../../../shared/components/entity-link/entity-link.component';

@Component({
  selector: 'app-purchase-order-list',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, ClpCurrencyPipe, PurchasesPushNoticeComponent, EntityLinkComponent],
  templateUrl: './purchase-order-list.component.html',
})
export class PurchaseOrderListComponent {
  private purchasesService = inject(PurchasesService);
  private notify = inject(NotificationService);

  orders = signal<PurchaseOrder[]>([]);
  isLoading = signal(false);
  statusFilter = signal('');

  statusLabels: Record<string, string> = {
    DRAFT: 'Borrador', PENDING_APPROVAL: 'Pendiente', PARTIALLY_APPROVED: 'Parcial',
    APPROVED: 'Aprobada', SENT: 'Enviada al proveedor', ORDERED: 'Pedida al proveedor',
    SENT_TO_SUPPLIER: 'Enviada (hist.)', PARTIALLY_RECEIVED: 'Recepción Parcial',
    RECEIVED: 'Recibida', CLOSED: 'Cerrada', CANCELLED: 'Cancelada',
  };

  statusColors: Record<string, string> = {
    DRAFT: 'bg-gray-500/10 text-gray-400', PENDING_APPROVAL: 'bg-orange-500/10 text-orange-400',
    PARTIALLY_APPROVED: 'bg-yellow-500/10 text-yellow-400', APPROVED: 'bg-green-500/10 text-green-400',
    SENT: 'bg-blue-500/10 text-blue-400', ORDERED: 'bg-blue-500/10 text-blue-400',
    SENT_TO_SUPPLIER: 'bg-blue-500/10 text-blue-400', PARTIALLY_RECEIVED: 'bg-purple-500/10 text-purple-400',
    RECEIVED: 'bg-green-500/10 text-green-400', CLOSED: 'bg-gray-500/10 text-gray-400',
    CANCELLED: 'bg-red-500/10 text-red-400',
  };

  filteredOrders = computed(() => {
    const status = this.statusFilter();
    return status ? this.orders().filter(o => o.status === status) : this.orders();
  });

  constructor() { this.loadOrders(); }

  loadOrders() {
    this.isLoading.set(true);
    this.purchasesService.getOrders().subscribe({
      next: (data) => { this.orders.set(data); this.isLoading.set(false); },
      error: (err: unknown) => {
        const msg =
          err && typeof err === 'object' && 'error' in err
            ? (err as { error?: { message?: string } }).error?.message
            : undefined;
        this.notify.error(typeof msg === 'string' ? msg : 'Error al cargar órdenes');
        this.isLoading.set(false);
      },
    });
  }
}
