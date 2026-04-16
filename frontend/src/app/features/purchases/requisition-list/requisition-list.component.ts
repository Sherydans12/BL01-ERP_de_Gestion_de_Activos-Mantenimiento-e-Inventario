import { Component, signal, computed, effect, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { PurchasesService, PurchaseRequisition } from '../../../core/services/purchases/purchases.service';
import { AuthService } from '../../../core/services/auth/auth.service';
import { NotificationService } from '../../../core/services/notification/notification.service';
import { PurchasesPushNoticeComponent } from '../../../shared/components/purchases-push-notice/purchases-push-notice.component';
import { EntityLinkComponent } from '../../../shared/components/entity-link/entity-link.component';

@Component({
  selector: 'app-requisition-list',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, PurchasesPushNoticeComponent, EntityLinkComponent],
  templateUrl: './requisition-list.component.html',
})
export class RequisitionListComponent {
  private purchasesService = inject(PurchasesService);
  private authService = inject(AuthService);
  private notify = inject(NotificationService);

  requisitions = signal<PurchaseRequisition[]>([]);
  isLoading = signal(false);
  statusFilter = signal('');
  /** Si false, oculta SRC en CLOSED salvo que el filtro sea «Cerrado». */
  showClosedInList = signal(false);

  statusLabels: Record<string, string> = {
    DRAFT: 'Borrador',
    SUBMITTED: 'Enviado',
    QUOTING: 'En Cotización',
    PENDING_APPROVAL: 'Pendiente Aprobación',
    PARTIALLY_PURCHASED: 'Compra parcial',
    APPROVED: 'Aprobado',
    REJECTED: 'Rechazado',
    CANCELLED: 'Cancelado',
    CLOSED: 'Cerrado (completo)',
  };

  statusColors: Record<string, string> = {
    DRAFT: 'bg-gray-500/10 text-gray-400',
    SUBMITTED: 'bg-blue-500/10 text-blue-400',
    QUOTING: 'bg-yellow-500/10 text-yellow-400',
    PENDING_APPROVAL: 'bg-orange-500/10 text-orange-400',
    PARTIALLY_PURCHASED: 'bg-cyan-500/12 text-cyan-300 border border-cyan-500/35',
    APPROVED: 'bg-green-500/10 text-green-400',
    REJECTED: 'bg-red-500/10 text-red-400',
    CANCELLED: 'bg-red-500/10 text-red-400',
    CLOSED: 'bg-zinc-500/15 text-zinc-300 border border-zinc-500/30',
  };

  filteredRequisitions = computed(() => {
    const status = this.statusFilter();
    let rows = this.requisitions();
    if (!status) {
      if (!this.showClosedInList()) {
        rows = rows.filter((r) => r.status !== 'CLOSED');
      }
    } else {
      rows = rows.filter((r) => r.status === status);
    }
    return rows;
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
      error: (err: unknown) => {
        const msg =
          err && typeof err === 'object' && 'error' in err
            ? (err as { error?: { message?: string } }).error?.message
            : undefined;
        this.notify.error(typeof msg === 'string' ? msg : 'Error al cargar requerimientos');
        this.isLoading.set(false);
      },
    });
  }
}
