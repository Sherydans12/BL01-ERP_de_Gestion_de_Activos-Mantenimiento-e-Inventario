import { Component, signal, computed, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import {
  PurchasesService,
  PurchaseOrder,
  PurchaseInvoice,
  ActivityLogEntry,
} from '../../../core/services/purchases/purchases.service';
import { NotificationService } from '../../../core/services/notification/notification.service';
import { ClpCurrencyPipe } from '../../../shared/pipes/clp-currency.pipe';
import { PurchasesPushNoticeComponent } from '../../../shared/components/purchases-push-notice/purchases-push-notice.component';
import { ActivityTimelineComponent } from '../../../shared/components/activity-timeline/activity-timeline.component';
import { ConfirmModalComponent } from '../../../shared/components/confirm-modal/confirm-modal.component';
import { AuthService } from '../../../core/services/auth/auth.service';

@Component({
  selector: 'app-purchase-invoice-form',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    ClpCurrencyPipe,
    PurchasesPushNoticeComponent,
    ActivityTimelineComponent,
    ConfirmModalComponent,
  ],
  templateUrl: './purchase-invoice-form.component.html',
})
export class PurchaseInvoiceFormComponent implements OnInit {
  /** Etiquetas de estado de OC (misma nomenclatura que en detalle de orden). */
  readonly poStatusLabels: Record<string, string> = {
    DRAFT: 'Borrador',
    PENDING_APPROVAL: 'Pendiente de aprobación',
    PARTIALLY_APPROVED: 'Aprobación parcial',
    APPROVED: 'Aprobada',
    REJECTED: 'Rechazada',
    SENT: 'Enviada al proveedor',
    ORDERED: 'Pedida al proveedor',
    SENT_TO_SUPPLIER: 'Enviada al proveedor',
    PARTIALLY_RECEIVED: 'Recepción parcial',
    RECEIVED: 'Recepción completa',
    CLOSED: 'Cerrada',
    CANCELLED: 'Anulada',
  };

  private purchasesService = inject(PurchasesService);
  private notify = inject(NotificationService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private auth = inject(AuthService);

  order = signal<PurchaseOrder | null>(null);
  isLoading = signal(true);
  isSaving = signal(false);

  invoiceNumber = signal('');
  emissionDate = signal('');
  dueDate = signal('');
  totalAmount = signal<number | null>(null);
  netAmount = signal<number | null>(null);
  taxAmount = signal<number | null>(null);
  pdfFile = signal<File | null>(null);

  activityLogs = signal<ActivityLogEntry[]>([]);
  activityLogsLoading = signal(false);
  showDeleteInvoiceModal = signal(false);
  requireExtraDeleteAck = computed(
    () => !this.auth.hasRole(['ADMIN', 'SUPER_ADMIN']),
  );

  canRegister = computed(() => {
    const o = this.order();
    if (!o) return false;
    return ['APPROVED', 'SENT', 'ORDERED', 'SENT_TO_SUPPLIER'].includes(o.status);
  });

  existingInvoice = computed(() => this.order()?.purchaseInvoice ?? null);

  ngOnInit() {
    const orderId = this.route.snapshot.paramMap.get('orderId');
    if (orderId) this.load(orderId);
  }

  private defaultDueDateFromEmission(ymd: string): string {
    const d = new Date(`${ymd}T12:00:00`);
    if (Number.isNaN(d.getTime())) return '';
    d.setDate(d.getDate() + 30);
    return d.toISOString().slice(0, 10);
  }

  load(orderId: string) {
    this.isLoading.set(true);
    this.activityLogsLoading.set(true);
    this.purchasesService.getOrderActivityLogs(orderId).subscribe({
      next: (logs) => {
        const sorted = [...logs].sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );
        this.activityLogs.set(sorted);
        this.activityLogsLoading.set(false);
      },
      error: () => {
        this.activityLogs.set([]);
        this.activityLogsLoading.set(false);
      },
    });

    this.purchasesService.getOrder(orderId).subscribe({
      next: (data) => {
        this.order.set(data);
        const inv = data.purchaseInvoice;
        if (inv) {
          this.invoiceNumber.set(inv.invoiceNumber);
          this.emissionDate.set(inv.emissionDate.slice(0, 10));
          this.dueDate.set(
            inv.dueDate ? inv.dueDate.slice(0, 10) : this.defaultDueDateFromEmission(inv.emissionDate.slice(0, 10)),
          );
          this.totalAmount.set(Number(inv.totalAmount));
          this.netAmount.set(
            inv.netAmount != null && !Number.isNaN(Number(inv.netAmount))
              ? Number(inv.netAmount)
              : null,
          );
          this.taxAmount.set(
            inv.taxAmount != null && !Number.isNaN(Number(inv.taxAmount))
              ? Number(inv.taxAmount)
              : null,
          );
        } else {
          const em = new Date().toISOString().slice(0, 10);
          this.emissionDate.set(em);
          this.dueDate.set(this.defaultDueDateFromEmission(em));
          this.totalAmount.set(Number(data.totalAmount));
          this.netAmount.set(null);
          this.taxAmount.set(null);
        }
        this.isLoading.set(false);
      },
      error: (err: unknown) => {
        const msg =
          err && typeof err === 'object' && 'error' in err
            ? (err as { error?: { message?: string } }).error?.message
            : undefined;
        this.notify.error(typeof msg === 'string' ? msg : 'Error al cargar la orden');
        this.isLoading.set(false);
      },
    });
  }

  onFileChange(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    this.pdfFile.set(file ?? null);
  }

  requestDeleteInvoice() {
    if (!this.existingInvoice()) return;
    this.showDeleteInvoiceModal.set(true);
  }

  cancelDeleteInvoiceModal() {
    this.showDeleteInvoiceModal.set(false);
  }

  confirmDeleteInvoice() {
    const invoice = this.existingInvoice();
    const orderId = this.order()?.id;
    if (!invoice || !orderId) return;
    this.showDeleteInvoiceModal.set(false);
    this.isSaving.set(true);
    this.purchasesService.deletePurchaseInvoice(invoice.id).subscribe({
      next: () => {
        this.notify.success('Factura eliminada. Debe conciliar nuevamente el 3-way match.');
        this.load(orderId);
        this.isSaving.set(false);
      },
      error: (err: unknown) => this.onSaveError(err),
    });
  }

  save() {
    const o = this.order();
    if (!o?.quotation?.vendorId) {
      this.notify.error('La orden no tiene proveedor adjudicado.');
      return;
    }
    const num = this.invoiceNumber().trim();
    const amt = this.totalAmount();
    const em = this.emissionDate();
    if (!num || amt == null || Number.isNaN(amt) || !em) {
      this.notify.error('Complete número de factura, fecha de emisión y monto total.');
      return;
    }

    const existing = o.purchaseInvoice;
    this.isSaving.set(true);

    const fd = new FormData();
    fd.append('invoiceNumber', num);
    fd.append('emissionDate', new Date(em).toISOString());
    fd.append('totalAmount', String(amt));

    const due = this.dueDate().trim();
    if (due) {
      fd.append('dueDate', new Date(`${due}T12:00:00`).toISOString());
    }

    const net = this.netAmount();
    const tax = this.taxAmount();
    if (existing) {
      fd.append('netAmount', net == null || Number.isNaN(net) ? '' : String(net));
      fd.append('taxAmount', tax == null || Number.isNaN(tax) ? '' : String(tax));
    } else {
      if (net != null && !Number.isNaN(net)) fd.append('netAmount', String(net));
      if (tax != null && !Number.isNaN(tax)) fd.append('taxAmount', String(tax));
    }

    const file = this.pdfFile();
    if (file) fd.append('pdf', file, file.name);

    if (existing) {
      this.purchasesService.updatePurchaseInvoice(existing.id, fd).subscribe({
        next: (res) => this.afterSave(res, o.id),
        error: (err: unknown) => this.onSaveError(err),
      });
    } else {
      fd.append('purchaseOrderId', o.id);
      fd.append('vendorId', o.quotation.vendorId);
      this.purchasesService.createPurchaseInvoice(fd).subscribe({
        next: (res) => this.afterSave(res, o.id),
        error: (err: unknown) => this.onSaveError(err),
      });
    }
  }

  private afterSave(res: PurchaseInvoice & { match?: PurchaseInvoice['match'] }, orderId: string) {
    this.isSaving.set(false);
    this.pdfFile.set(null);
    if (res.status === 'MATCHED') {
      this.notify.success('Factura registrada: 3-way match OK (OC, recepción y factura).');
    } else if (res.status === 'DISCREPANCY') {
      this.notify.warning('Factura registrada con discrepancias. Revise montos y recepciones.');
    } else {
      this.notify.success('Factura guardada.');
    }
    this.router.navigate(['/app/compras/ordenes', orderId], {
      queryParams: { tab: 'billing' },
    });
  }

  private onSaveError(err: unknown) {
    this.isSaving.set(false);
    const msg =
      err && typeof err === 'object' && 'error' in err
        ? (err as { error?: { message?: string } }).error?.message
        : undefined;
    this.notify.error(typeof msg === 'string' ? msg : 'Error al guardar la factura');
  }

  labelPoStatus(code: string): string {
    return this.poStatusLabels[code] ?? code;
  }
}
