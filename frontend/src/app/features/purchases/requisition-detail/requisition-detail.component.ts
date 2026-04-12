import { Component, signal, computed, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { PurchasesService, PurchaseRequisition, PurchaseQuotation } from '../../../core/services/purchases/purchases.service';
import { NotificationService } from '../../../core/services/notification/notification.service';
import { ClpCurrencyPipe } from '../../../shared/pipes/clp-currency.pipe';

@Component({
  selector: 'app-requisition-detail',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, ClpCurrencyPipe],
  templateUrl: './requisition-detail.component.html',
})
export class RequisitionDetailComponent implements OnInit {
  private purchasesService = inject(PurchasesService);
  private notify = inject(NotificationService);
  private route = inject(ActivatedRoute);

  requisition = signal<PurchaseRequisition | null>(null);
  isLoading = signal(true);
  isSubmitting = signal(false);

  statusLabels: Record<string, string> = {
    DRAFT: 'Borrador', SUBMITTED: 'Enviado', QUOTING: 'En Cotización',
    PENDING_APPROVAL: 'Pendiente Aprobación', APPROVED: 'Aprobado',
    REJECTED: 'Rechazado', CANCELLED: 'Cancelado',
  };

  canSubmit = computed(() => this.requisition()?.status === 'DRAFT');
  canAddQuotation = computed(() => {
    const s = this.requisition()?.status;
    return s === 'SUBMITTED' || s === 'QUOTING';
  });
  canSelectWinner = computed(() => this.requisition()?.status === 'QUOTING');

  winnerQuotation = computed(() =>
    this.requisition()?.quotations?.find(q => q.isWinner) ?? null
  );

  selectedQuote = signal<PurchaseQuotation | null>(null);

  readonly approvalFlow = computed(() => {
    const amount = this.selectedQuote()?.totalAmount || 0;
    return amount >= 5000000 ? 'TRIPLE_SIGNATURE' : 'DUAL_SIGNATURE';
  });

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) this.load(id);
  }

  load(id: string) {
    this.isLoading.set(true);
    this.purchasesService.getRequisition(id).subscribe({
      next: (data) => { this.requisition.set(data); this.isLoading.set(false); },
      error: () => { this.notify.error('Error al cargar requerimiento'); this.isLoading.set(false); },
    });
  }

  submit() {
    const req = this.requisition();
    if (!req) return;
    this.isSubmitting.set(true);
    this.purchasesService.submitRequisition(req.id).subscribe({
      next: () => { this.notify.success('Requerimiento enviado'); this.load(req.id); this.isSubmitting.set(false); },
      error: () => { this.notify.error('Error al enviar'); this.isSubmitting.set(false); },
    });
  }

  selectWinner(quotationId: string) {
    const req = this.requisition();
    if (!req) return;
    this.purchasesService.selectQuotation(req.id, quotationId).subscribe({
      next: () => { this.notify.success('Cotización seleccionada como ganadora'); this.load(req.id); },
      error: () => this.notify.error('Error al seleccionar cotización'),
    });
  }

  createOrder() {
    const winner = this.winnerQuotation();
    if (!winner) return;
    this.purchasesService.createOrder(winner.id).subscribe({
      next: (order) => this.notify.success(`Orden de compra ${order.correlative} creada`),
      error: (err: any) => this.notify.error(err?.error?.message || 'Error al crear OC'),
    });
  }
}
