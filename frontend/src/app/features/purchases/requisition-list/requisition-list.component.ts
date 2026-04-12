import { Component, signal, computed, effect, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { PurchasesService, PurchaseRequisition } from '../../../core/services/purchases/purchases.service';
import { AuthService } from '../../../core/services/auth/auth.service';
import { NotificationService } from '../../../core/services/notification/notification.service';

@Component({
  selector: 'app-requisition-list',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  templateUrl: './requisition-list.component.html',
})
export class RequisitionListComponent {
  private purchasesService = inject(PurchasesService);
  private authService = inject(AuthService);
  private notify = inject(NotificationService);

  requisitions = signal<PurchaseRequisition[]>([]);
  isLoading = signal(false);
  statusFilter = signal('');

  statusLabels: Record<string, string> = {
    DRAFT: 'Borrador',
    SUBMITTED: 'Enviado',
    QUOTING: 'En Cotización',
    PENDING_APPROVAL: 'Pendiente Aprobación',
    APPROVED: 'Aprobado',
    REJECTED: 'Rechazado',
    CANCELLED: 'Cancelado',
  };

  statusColors: Record<string, string> = {
    DRAFT: 'bg-gray-500/10 text-gray-400',
    SUBMITTED: 'bg-blue-500/10 text-blue-400',
    QUOTING: 'bg-yellow-500/10 text-yellow-400',
    PENDING_APPROVAL: 'bg-orange-500/10 text-orange-400',
    APPROVED: 'bg-green-500/10 text-green-400',
    REJECTED: 'bg-red-500/10 text-red-400',
    CANCELLED: 'bg-red-500/10 text-red-400',
  };

  filteredRequisitions = computed(() => {
    const status = this.statusFilter();
    return status
      ? this.requisitions().filter(r => r.status === status)
      : this.requisitions();
  });

  constructor() {
    effect(() => {
      const _contract = this.authService.currentContractId();
      this.loadRequisitions();
    }, { allowSignalWrites: true });
  }

  loadRequisitions() {
    this.isLoading.set(true);
    this.purchasesService.getRequisitions().subscribe({
      next: (data) => { this.requisitions.set(data); this.isLoading.set(false); },
      error: () => { this.notify.error('Error al cargar requerimientos'); this.isLoading.set(false); },
    });
  }
}
