import { Component, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { PurchasesService, WarehouseReceipt } from '../../../core/services/purchases/purchases.service';
import { NotificationService } from '../../../core/services/notification/notification.service';

@Component({
  selector: 'app-receipt-list',
  standalone: true,
  imports: [CommonModule, RouterModule],
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
      error: () => { this.notify.error('Error al cargar recepciones'); this.isLoading.set(false); },
    });
  }
}
