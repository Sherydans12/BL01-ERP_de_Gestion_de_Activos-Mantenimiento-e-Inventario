import { Component, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { PurchasesService, WarehouseReceipt } from '../../../core/services/purchases/purchases.service';
import { NotificationService } from '../../../core/services/notification/notification.service';
import { PurchasesPushNoticeComponent } from '../../../shared/components/purchases-push-notice/purchases-push-notice.component';
import { EntityLinkComponent } from '../../../shared/components/entity-link/entity-link.component';

@Component({
  selector: 'app-receipt-list',
  standalone: true,
  imports: [CommonModule, RouterModule, PurchasesPushNoticeComponent, EntityLinkComponent],
  templateUrl: './receipt-list.component.html',
})
export class ReceiptListComponent {
  private purchasesService = inject(PurchasesService);
  private notify = inject(NotificationService);

  receipts = signal<WarehouseReceipt[]>([]);
  isLoading = signal(false);

  statusLabels: Record<string, string> = { PENDING: 'Pendiente', PARTIAL: 'Parcial', COMPLETED: 'Completa' };
  statusColors: Record<string, string> = {
    PENDING: 'bg-yellow-500/10 text-yellow-400',
    PARTIAL: 'bg-orange-500/10 text-orange-400',
    COMPLETED: 'bg-green-500/10 text-green-400',
  };

  constructor() { this.loadReceipts(); }

  loadReceipts() {
    this.isLoading.set(true);
    this.purchasesService.getReceipts().subscribe({
      next: (data) => { this.receipts.set(data); this.isLoading.set(false); },
      error: (err: unknown) => {
        const msg =
          err && typeof err === 'object' && 'error' in err
            ? (err as { error?: { message?: string } }).error?.message
            : undefined;
        this.notify.error(typeof msg === 'string' ? msg : 'Error al cargar recepciones');
        this.isLoading.set(false);
      },
    });
  }
}
