import { Component, signal, computed, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { PurchasesService, PurchaseRequisition, PurchaseQuotation } from '../../../core/services/purchases/purchases.service';
import { NotificationService } from '../../../core/services/notification/notification.service';
import { AuthService } from '../../../core/services/auth/auth.service';
import { VendorsService, Vendor } from '../../../core/services/vendors/vendors.service';
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
  private auth = inject(AuthService);
  private vendorsService = inject(VendorsService);
  private route = inject(ActivatedRoute);

  requisition = signal<PurchaseRequisition | null>(null);
  isLoading = signal(true);
  isSubmitting = signal(false);
  isStartingQuotation = signal(false);
  isSavingQuotation = signal(false);

  /** Misma política que addQuotation / selectQuotation en el backend. */
  canManagePurchases = computed(() =>
    this.auth.hasRole(['ADMIN', 'SUPERVISOR']),
  );

  statusLabels: Record<string, string> = {
    DRAFT: 'Borrador', SUBMITTED: 'Enviado', QUOTING: 'En Cotización',
    PENDING_APPROVAL: 'Pendiente Aprobación', APPROVED: 'Aprobado',
    REJECTED: 'Rechazado', CANCELLED: 'Cancelado',
  };

  canSubmit = computed(() => this.requisition()?.status === 'DRAFT');

  /** Enviado (SUBMITTED): solo compras puede pasar a fase de cotización explícita. */
  canStartQuoting = computed(() => {
    const s = this.requisition()?.status;
    return s === 'SUBMITTED' && this.canManagePurchases();
  });

  /** Agregar cotización solo en QUOTING y con rol de compras. */
  canAddQuotation = computed(() => {
    const s = this.requisition()?.status;
    return s === 'QUOTING' && this.canManagePurchases();
  });

  canSelectWinner = computed(() => {
    const s = this.requisition()?.status;
    return s === 'QUOTING' && this.canManagePurchases();
  });

  showQuotationForm = signal(false);
  vendors = signal<Vendor[]>([]);
  quotationVendorId = '';
  quotationDeliveryDays: number | null = null;
  quotationValidUntil = '';
  quotationFile: File | null = null;
  /** Precio unitario por ítem del requerimiento (id de línea → monto). */
  unitPrices: Record<string, number> = {};

  winnerQuotation = computed(() =>
    this.requisition()?.quotations?.find(q => q.isWinner) ?? null
  );

  selectedQuote = signal<PurchaseQuotation | null>(null);

  readonly approvalFlow = computed(() => {
    const amount = this.selectedQuote()?.totalAmount || 0;
    return amount >= 5000000 ? 'TRIPLE_SIGNATURE' : 'DUAL_SIGNATURE';
  });

  /** Muestra la sección de cotizaciones (tabla vacía o con filas). */
  showQuotationsSection = computed(() => {
    const r = this.requisition();
    if (!r) return false;
    const n = r.quotations?.length ?? 0;
    if (n > 0) return true;
    return r.status === 'QUOTING' && this.canManagePurchases();
  });

  /** Total cotización (no es signal: se recalcula al cambiar precios en la plantilla). */
  getQuotationTotal(): number {
    const req = this.requisition();
    if (!req) return 0;
    let sum = 0;
    for (const item of req.items) {
      const unit = Number(this.unitPrices[item.id] ?? 0);
      sum += unit * Number(item.quantity);
    }
    return sum;
  }

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) this.load(id);
  }

  load(id: string) {
    this.isLoading.set(true);
    this.purchasesService.getRequisition(id).subscribe({
      next: (data) => {
        this.requisition.set(data);
        this.resetQuotationForm();
        this.isLoading.set(false);
      },
      error: () => { this.notify.error('Error al cargar requerimiento'); this.isLoading.set(false); },
    });
  }

  private resetQuotationForm() {
    this.unitPrices = {};
    this.quotationVendorId = '';
    this.quotationDeliveryDays = null;
    this.quotationValidUntil = '';
    this.quotationFile = null;
    this.showQuotationForm.set(false);
  }

  ensureVendorsLoaded() {
    if (this.vendors().length > 0) return;
    this.vendorsService.getAll().subscribe({
      next: (list) => this.vendors.set(list.filter((v) => v.isActive)),
      error: () => this.notify.error('Error al cargar proveedores'),
    });
  }

  toggleQuotationForm() {
    const next = !this.showQuotationForm();
    this.showQuotationForm.set(next);
    if (next) {
      this.ensureVendorsLoaded();
      const req = this.requisition();
      if (req) {
        const m: Record<string, number> = { ...this.unitPrices };
        for (const item of req.items) {
          if (m[item.id] === undefined) m[item.id] = 0;
        }
        this.unitPrices = m;
      }
    }
  }

  startQuoting() {
    const req = this.requisition();
    if (!req) return;
    this.isStartingQuotation.set(true);
    this.purchasesService.updateStatus(req.id, 'QUOTING').subscribe({
      next: () => {
        this.notify.success('Fase de cotización iniciada');
        this.load(req.id);
        this.isStartingQuotation.set(false);
      },
      error: (err: unknown) => {
        const msg =
          err && typeof err === 'object' && 'error' in err && (err as { error?: { message?: string } }).error?.message;
        this.notify.error(typeof msg === 'string' ? msg : 'Error al iniciar cotización');
        this.isStartingQuotation.set(false);
      },
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

  submitQuotation() {
    const req = this.requisition();
    if (!req) return;
    if (!this.quotationVendorId) {
      this.notify.warning('Seleccione un proveedor');
      return;
    }
    const items = req.items.map((item) => ({
      requisitionItemId: item.id,
      unitPrice: Number(this.unitPrices[item.id] ?? 0),
    }));
    if (items.some((i) => !Number.isFinite(i.unitPrice) || i.unitPrice < 0)) {
      this.notify.warning('Indique precios unitarios válidos');
      return;
    }
    const totalAmount = this.getQuotationTotal();
    if (totalAmount <= 0) {
      this.notify.warning('El monto total debe ser mayor a cero');
      return;
    }

    const payload = {
      vendorId: this.quotationVendorId,
      totalAmount,
      currency: 'CLP',
      deliveryDays: this.quotationDeliveryDays ?? undefined,
      validUntil: this.quotationValidUntil || undefined,
      items,
    };

    this.isSavingQuotation.set(true);
    this.purchasesService
      .addQuotation(req.id, payload, this.quotationFile ?? undefined)
      .subscribe({
        next: () => {
          this.notify.success('Cotización registrada');
          this.load(req.id);
          this.isSavingQuotation.set(false);
        },
        error: (err: unknown) => {
          const msg =
            err && typeof err === 'object' && 'error' in err && (err as { error?: { message?: string } }).error?.message;
          this.notify.error(typeof msg === 'string' ? msg : 'Error al registrar cotización');
          this.isSavingQuotation.set(false);
        },
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
