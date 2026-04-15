import { Component, signal, computed, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import {
  PurchasesService,
  PurchaseRequisition,
  PurchaseQuotation,
  QuotationItem,
  ActivityLogEntry,
} from '../../../core/services/purchases/purchases.service';
import { NotificationService } from '../../../core/services/notification/notification.service';
import { AuthService } from '../../../core/services/auth/auth.service';
import { VendorsService, Vendor } from '../../../core/services/vendors/vendors.service';
import { ClpCurrencyPipe } from '../../../shared/pipes/clp-currency.pipe';
import { ConfirmModalComponent } from '../../../shared/components/confirm-modal/confirm-modal.component';
import { PurchasesPushNoticeComponent } from '../../../shared/components/purchases-push-notice/purchases-push-notice.component';
import { EquipmentDetailModalComponent } from '../../fleet/equipment-detail-modal/equipment-detail-modal.component';
import { WorkOrderDetailModalComponent } from '../../work-orders/work-order-detail-modal/work-order-detail-modal.component';
import { ActivityTimelineComponent } from '../../../shared/components/activity-timeline/activity-timeline.component';

@Component({
  selector: 'app-requisition-detail',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    FormsModule,
    ClpCurrencyPipe,
    ConfirmModalComponent,
    PurchasesPushNoticeComponent,
    EquipmentDetailModalComponent,
    WorkOrderDetailModalComponent,
    ActivityTimelineComponent,
  ],
  templateUrl: './requisition-detail.component.html',
})
export class RequisitionDetailComponent implements OnInit {
  private purchasesService = inject(PurchasesService);
  private notify = inject(NotificationService);
  private auth = inject(AuthService);
  private vendorsService = inject(VendorsService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  requisition = signal<PurchaseRequisition | null>(null);
  isLoading = signal(true);
  activityLogs = signal<ActivityLogEntry[]>([]);
  activityLogsLoading = signal(false);
  isSubmitting = signal(false);
  isDuplicating = signal(false);
  isStartingQuotation = signal(false);
  isSavingQuotation = signal(false);
  /** Generación de OC en curso (evita doble clic y asegura recarga al terminar). */
  isCreatingOrder = signal(false);
  /** Modal de advertencia antes de enviar un requerimiento en borrador. */
  showSubmitConfirmModal = signal(false);
  /** Iniciar fase de cotización (cambia el flujo del requerimiento). */
  showStartQuotingModal = signal(false);
  /** Elegir cotización ganadora (rechaza las demás de forma persistente). */
  showSelectWinnerModal = signal(false);
  pendingSelectWinnerQuotationId = signal<string | null>(null);
  /** Generar OC desde la cotización ganadora. */
  showCreateOrderModal = signal(false);
  /** Registrar cotización definitiva. */
  showSubmitQuotationModal = signal(false);
  showCancelRequisitionModal = signal(false);

  private pendingQuotationSubmit: {
    requisitionId: string;
    payload: {
      vendorId: string;
      totalAmount: number;
      currency: string;
      deliveryDays?: number;
      validUntil?: string;
      items: Array<{
        requisitionItemId: string;
        unitPrice: number;
        brand?: string;
        notes?: string;
      }>;
    };
    file: File | undefined;
  } | null = null;

  /** Misma política que addQuotation / selectQuotation en el backend. */
  canManagePurchases = computed(() =>
    this.auth.hasRole(['ADMIN', 'SUPERVISOR']),
  );

  statusLabels: Record<string, string> = {
    DRAFT: 'Borrador', SUBMITTED: 'Enviado', QUOTING: 'En cotización',
    PENDING_APPROVAL: 'Pendiente de aprobación', APPROVED: 'Aprobado',
    REJECTED: 'Rechazado', CANCELLED: 'Cancelado',
  };

  priorityLabel(p?: string): string {
    const m: Record<string, string> = {
      LOW: 'Prioridad baja',
      MEDIUM: 'Prioridad media',
      HIGH: 'Prioridad alta',
    };
    return m[p ?? 'MEDIUM'] ?? 'Prioridad media';
  }

  priorityClass(p?: string): string {
    const x = p ?? 'MEDIUM';
    const m: Record<string, string> = {
      LOW: 'bg-slate-500/15 text-slate-300 border border-slate-500/30',
      MEDIUM: 'bg-amber-500/15 text-amber-300 border border-amber-500/35',
      HIGH: 'bg-rose-500/15 text-rose-300 border border-rose-500/40',
    };
    return m[x] ?? m['MEDIUM'];
  }

  canSubmit = computed(() => this.requisition()?.status === 'DRAFT');
  canCancelRequisition = computed(() => {
    const s = this.requisition()?.status;
    return !!s && ['DRAFT', 'SUBMITTED', 'QUOTING', 'PENDING_APPROVAL'].includes(s) && this.canManagePurchases();
  });
  requireExtraCancelConfirmation = computed(
    () => !this.auth.hasRole(['ADMIN', 'SUPER_ADMIN']),
  );
  cancelRiskSummary = computed(() => {
    const req = this.requisition();
    if (!req) return '';
    const hasWinner = !!(req.quotations ?? []).find((q) => q.isWinner);
    const highPriority = req.priority === 'HIGH';
    if (hasWinner && highPriority) {
      return 'Este requerimiento ya tiene adjudicación de cotización y además está marcado con prioridad alta.';
    }
    if (hasWinner) {
      return 'Este requerimiento ya tiene una cotización ganadora; si existe OC activa vinculada, la anulación será bloqueada.';
    }
    if (highPriority) {
      return 'Requerimiento de prioridad alta: valide impacto operativo en abastecimiento antes de anular.';
    }
    return 'La anulación quedará registrada en la trazabilidad del ciclo de compras.';
  });

  /** Borrador: solicitante o admin. En cotización: solo compras (misma regla que cotizar). */
  canEditRequisition = computed(() => {
    const r = this.requisition();
    const u = this.auth.currentUser();
    if (!r || !u) return false;
    if (r.status === 'DRAFT') {
      return (
        r.requestedById === u.id ||
        u.role === 'ADMIN' ||
        u.role === 'SUPER_ADMIN'
      );
    }
    if (r.status === 'QUOTING' || r.status === 'PENDING_APPROVAL') {
      return this.canManagePurchases();
    }
    return false;
  });

  /** Enviado (SUBMITTED): solo compras puede pasar a fase de cotización explícita. */
  canStartQuoting = computed(() => {
    const s = this.requisition()?.status;
    return s === 'SUBMITTED' && this.canManagePurchases();
  });

  /** Agregar cotización en cotización o con ganadora aún sin OC. */
  canAddQuotation = computed(() => {
    const s = this.requisition()?.status;
    return (s === 'QUOTING' || s === 'PENDING_APPROVAL') && this.canManagePurchases();
  });

  canSelectWinner = computed(() => {
    const s = this.requisition()?.status;
    return (s === 'QUOTING' || s === 'PENDING_APPROVAL') && this.canManagePurchases();
  });

  showQuotationForm = signal(false);
  showInlineVendorForm = signal(false);
  isCreatingVendor = signal(false);
  vendors = signal<Vendor[]>([]);
  newVendorCode = '';
  newVendorName = '';
  newVendorRut = '';
  quotationVendorId = '';
  quotationDeliveryDays: number | null = null;
  quotationValidUntil = '';
  quotationFile: File | null = null;
  /** Precio unitario por ítem del requerimiento (id de línea → monto). */
  unitPrices: Record<string, number> = {};
  /** Marca ofrecida por línea (opcional; mismo alcance que en el cuadro comparativo). */
  lineBrands: Record<string, string> = {};
  /** Notas de la cotización por línea (opcional). */
  lineNotes: Record<string, string> = {};

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
    return (r.status === 'QUOTING' || r.status === 'PENDING_APPROVAL') && this.canManagePurchases();
  });

  /** Subtotal línea cotización = P.U. × cantidad del requerimiento. */
  quotationLineSubtotal(line: QuotationItem): number {
    const qty = line.requisitionItem?.quantity;
    if (qty == null) return 0;
    return Number(line.unitPrice) * Number(qty);
  }

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
    this.activityLogsLoading.set(true);
    this.purchasesService.getRequisition(id).subscribe({
      next: (data) => {
        this.requisition.set(data);
        this.resetQuotationForm();
        this.isLoading.set(false);
      },
      error: (err: unknown) => {
        const msg =
          err && typeof err === 'object' && 'error' in err
            ? (err as { error?: { message?: string } }).error?.message
            : undefined;
        this.notify.error(typeof msg === 'string' ? msg : 'Error al cargar requerimiento');
        this.isLoading.set(false);
      },
    });
    this.purchasesService.getRequisitionActivityLogs(id).subscribe({
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
  }

  duplicateRequisition() {
    const req = this.requisition();
    if (!req) return;
    this.isDuplicating.set(true);
    this.purchasesService.duplicateRequisition(req.id).subscribe({
      next: (newReq) => {
        this.isDuplicating.set(false);
        this.notify.success(`Requerimiento duplicado: ${newReq.correlative}`);
        this.router.navigate(['/app/compras/requerimientos', newReq.id]);
      },
      error: (err: unknown) => {
        const msg =
          err && typeof err === 'object' && 'error' in err
            ? (err as { error?: { message?: string } }).error?.message
            : undefined;
        this.notify.error(typeof msg === 'string' ? msg : 'Error al duplicar requerimiento');
        this.isDuplicating.set(false);
      },
    });
  }

  private resetQuotationForm() {
    this.unitPrices = {};
    this.lineBrands = {};
    this.lineNotes = {};
    this.quotationVendorId = '';
    this.quotationDeliveryDays = null;
    this.quotationValidUntil = '';
    this.quotationFile = null;
    this.showQuotationForm.set(false);
    this.showInlineVendorForm.set(false);
    this.newVendorCode = '';
    this.newVendorName = '';
    this.newVendorRut = '';
  }

  /** Lista actualizada al abrir el formulario de cotización. */
  ensureVendorsLoaded() {
    this.vendorsService.getAll().subscribe({
      next: (list) => this.vendors.set(list.filter((v) => v.isActive)),
      error: () => this.notify.error('Error al cargar proveedores'),
    });
  }

  toggleInlineVendorForm() {
    this.showInlineVendorForm.update((v) => !v);
  }

  createVendorInline() {
    const code = this.newVendorCode.trim();
    const name = this.newVendorName.trim();
    if (!code || !name) {
      this.notify.warning('Código y nombre del proveedor son obligatorios');
      return;
    }
    this.isCreatingVendor.set(true);
    this.vendorsService
      .create({
        code,
        name,
        rut: this.newVendorRut.trim() || undefined,
      })
      .subscribe({
        next: (created) => {
          this.notify.success('Proveedor creado y seleccionado');
          this.vendors.update((prev) =>
            [...prev, created].sort((a, b) => a.name.localeCompare(b.name, 'es')),
          );
          this.quotationVendorId = created.id;
          this.newVendorCode = '';
          this.newVendorName = '';
          this.newVendorRut = '';
          this.showInlineVendorForm.set(false);
          this.isCreatingVendor.set(false);
        },
        error: (err: unknown) => {
          const msg =
            err && typeof err === 'object' && 'error' in err && (err as { error?: { message?: string } }).error?.message;
          this.notify.error(typeof msg === 'string' ? msg : 'Error al crear proveedor');
          this.isCreatingVendor.set(false);
        },
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
        const b: Record<string, string> = { ...this.lineBrands };
        const n: Record<string, string> = { ...this.lineNotes };
        for (const item of req.items) {
          if (m[item.id] === undefined) m[item.id] = 0;
          if (b[item.id] === undefined) b[item.id] = '';
          if (n[item.id] === undefined) n[item.id] = '';
        }
        this.unitPrices = m;
        this.lineBrands = b;
        this.lineNotes = n;
      }
    }
  }

  requestStartQuoting() {
    this.showStartQuotingModal.set(true);
  }

  cancelStartQuoting() {
    this.showStartQuotingModal.set(false);
  }

  confirmStartQuoting() {
    this.showStartQuotingModal.set(false);
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

  /** Abre la advertencia; el envío real ocurre solo si el usuario confirma. */
  requestSubmitRequisition() {
    const req = this.requisition();
    if (!req || req.status !== 'DRAFT') return;
    this.showSubmitConfirmModal.set(true);
  }

  cancelSubmitRequisition() {
    this.showSubmitConfirmModal.set(false);
  }

  confirmSubmitRequisition() {
    this.showSubmitConfirmModal.set(false);
    this.submitRequisitionAfterConfirm();
  }

  requestCancelRequisition() {
    if (!this.canCancelRequisition()) return;
    this.showCancelRequisitionModal.set(true);
  }

  cancelCancelRequisitionModal() {
    this.showCancelRequisitionModal.set(false);
  }

  confirmCancelRequisition(reason: string | null) {
    const req = this.requisition();
    if (!req) return;
    const cancelReason = reason?.trim();
    if (!cancelReason) {
      this.notify.error('Debe indicar un motivo de anulación');
      return;
    }
    this.showCancelRequisitionModal.set(false);
    this.isSubmitting.set(true);
    this.purchasesService.cancelRequisition(req.id, cancelReason).subscribe({
      next: () => {
        this.notify.success('Requerimiento anulado');
        this.load(req.id);
        this.isSubmitting.set(false);
      },
      error: (err: unknown) => {
        const msg =
          err && typeof err === 'object' && 'error' in err
            ? (err as { error?: { message?: string } }).error?.message
            : undefined;
        this.notify.error(typeof msg === 'string' ? msg : 'Error al anular requerimiento');
        this.isSubmitting.set(false);
      },
    });
  }

  private submitRequisitionAfterConfirm() {
    const req = this.requisition();
    if (!req) return;
    this.isSubmitting.set(true);
    this.purchasesService.submitRequisition(req.id).subscribe({
      next: () => {
        this.notify.success('Requerimiento enviado');
        this.load(req.id);
        this.isSubmitting.set(false);
      },
      error: () => {
        this.notify.error('Error al enviar');
        this.isSubmitting.set(false);
      },
    });
  }

  /** Valida el formulario de cotización y abre el modal de confirmación. */
  requestSubmitQuotation() {
    const built = this.buildQuotationSubmitOrNull();
    if (!built) return;
    this.pendingQuotationSubmit = built;
    this.showSubmitQuotationModal.set(true);
  }

  cancelSubmitQuotation() {
    this.showSubmitQuotationModal.set(false);
    this.pendingQuotationSubmit = null;
  }

  confirmSubmitQuotation() {
    this.showSubmitQuotationModal.set(false);
    const pending = this.pendingQuotationSubmit;
    this.pendingQuotationSubmit = null;
    if (!pending) return;
    this.isSavingQuotation.set(true);
    this.purchasesService
      .addQuotation(pending.requisitionId, pending.payload, pending.file)
      .subscribe({
        next: () => {
          this.notify.success('Cotización registrada');
          this.load(pending.requisitionId);
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

  private buildQuotationSubmitOrNull(): typeof this.pendingQuotationSubmit {
    const req = this.requisition();
    if (!req) return null;
    if (!this.quotationVendorId) {
      this.notify.warning('Seleccione un proveedor');
      return null;
    }
    const items = req.items.map((item) => {
      const brand = (this.lineBrands[item.id] ?? '').trim();
      const notes = (this.lineNotes[item.id] ?? '').trim();
      return {
        requisitionItemId: item.id,
        unitPrice: Number(this.unitPrices[item.id] ?? 0),
        ...(brand ? { brand } : {}),
        ...(notes ? { notes } : {}),
      };
    });
    if (items.some((i) => !Number.isFinite(i.unitPrice) || i.unitPrice < 0)) {
      this.notify.warning('Indique precios unitarios válidos');
      return null;
    }
    const totalAmount = this.getQuotationTotal();
    if (totalAmount <= 0) {
      this.notify.warning('El monto total debe ser mayor a cero');
      return null;
    }
    return {
      requisitionId: req.id,
      payload: {
        vendorId: this.quotationVendorId,
        totalAmount,
        currency: 'CLP',
        deliveryDays: this.quotationDeliveryDays ?? undefined,
        validUntil: this.quotationValidUntil || undefined,
        items,
      },
      file: this.quotationFile ?? undefined,
    };
  }

  requestSelectWinner(quotationId: string) {
    this.pendingSelectWinnerQuotationId.set(quotationId);
    this.showSelectWinnerModal.set(true);
  }

  cancelSelectWinner() {
    this.showSelectWinnerModal.set(false);
    this.pendingSelectWinnerQuotationId.set(null);
  }

  confirmSelectWinner() {
    const quotationId = this.pendingSelectWinnerQuotationId();
    this.showSelectWinnerModal.set(false);
    this.pendingSelectWinnerQuotationId.set(null);
    if (!quotationId) return;
    const req = this.requisition();
    if (!req) return;
    this.purchasesService.selectQuotation(req.id, quotationId).subscribe({
      next: () => {
        this.notify.success('Cotización seleccionada como ganadora');
        this.load(req.id);
      },
      error: (err: unknown) => {
        const msg =
          err && typeof err === 'object' && 'error' in err
            ? (err as { error?: { message?: string } }).error?.message
            : undefined;
        this.notify.error(typeof msg === 'string' ? msg : 'Error al seleccionar cotización');
      },
    });
  }

  requestCreateOrder() {
    if (!this.winnerQuotation()) return;
    this.showCreateOrderModal.set(true);
  }

  cancelCreateOrder() {
    this.showCreateOrderModal.set(false);
  }

  confirmCreateOrder() {
    this.showCreateOrderModal.set(false);
    const winner = this.winnerQuotation();
    const req = this.requisition();
    if (!winner || !req) return;
    this.isCreatingOrder.set(true);
    this.purchasesService.createOrder(winner.id).subscribe({
      next: (order) => {
        this.notify.success(`Orden de compra ${order.correlative} creada`);
        this.load(req.id);
        this.isCreatingOrder.set(false);
      },
      error: (err: any) => {
        this.notify.error(err?.error?.message || 'Error al crear OC');
        this.isCreatingOrder.set(false);
      },
    });
  }

  showLinkedEquipmentModal = signal(false);
  linkedEquipmentDetailId = signal<string | null>(null);
  showLinkedOtModal = signal(false);
  linkedOtDetailId = signal<string | null>(null);

  openLinkedEquipmentModal(): void {
    const r = this.requisition();
    const id = r?.equipment?.id ?? r?.equipmentId ?? null;
    if (!id) return;
    this.linkedEquipmentDetailId.set(id);
    this.showLinkedEquipmentModal.set(true);
  }

  closeLinkedEquipmentModal(): void {
    this.showLinkedEquipmentModal.set(false);
    this.linkedEquipmentDetailId.set(null);
  }

  openLinkedOtModal(): void {
    const r = this.requisition();
    const id = r?.workOrder?.id ?? r?.workOrderId ?? null;
    if (!id) return;
    this.linkedOtDetailId.set(id);
    this.showLinkedOtModal.set(true);
  }

  closeLinkedOtModal(): void {
    this.showLinkedOtModal.set(false);
    this.linkedOtDetailId.set(null);
  }
}







