import { Component, signal, computed, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import {
  PurchasesService,
  PurchaseRequisition,
  RequisitionReconciliationSnapshot,
  PurchaseQuotation,
  QuotationItem,
  ActivityLogEntry,
  LineAward,
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
import { EntityLinkComponent } from '../../../shared/components/entity-link/entity-link.component';
import { PurchaseDocumentsPanelComponent } from '../../../shared/components/purchase-documents-panel/purchase-documents-panel.component';
import { PdfService } from '../../../core/services/pdf/pdf.service';
import { MAX_UPLOAD_FILE_BYTES } from '../../../core/constants/file-upload.constants';

const PO_INACTIVE = new Set(['CANCELLED', 'REJECTED']);

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
    EntityLinkComponent,
    PurchaseDocumentsPanelComponent,
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
  private pdfService = inject(PdfService);

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
  /** Generar OC desde la cotización ganadora (flujo legado). */
  showCreateOrderModal = signal(false);
  /** Confirmar generación split (varias OC desde adjudicación por ítem). */
  showGenerateSplitOrdersModal = signal(false);
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
    PENDING_APPROVAL: 'Pendiente de aprobación',
    PARTIALLY_PURCHASED: 'Compra parcial',
    APPROVED: 'Aprobado',
    REJECTED: 'Rechazado', CANCELLED: 'Cancelado',
    CLOSED: 'Cerrado (completo)',
  };

  statusBadgeClass: Record<string, string> = {
    DRAFT: 'bg-zinc-500/15 text-zinc-300',
    SUBMITTED: 'bg-sky-500/15 text-sky-300',
    QUOTING: 'bg-indigo-500/15 text-indigo-300',
    PENDING_APPROVAL: 'bg-amber-500/15 text-amber-300',
    PARTIALLY_PURCHASED: 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/35',
    APPROVED: 'bg-emerald-500/15 text-emerald-300',
    REJECTED: 'bg-red-500/15 text-red-300',
    CANCELLED: 'bg-zinc-600/20 text-zinc-400',
    CLOSED: 'bg-zinc-500/15 text-zinc-200 border border-zinc-500/35',
  };

  /** Selección local: requisitionItemId → quotationItemId adjudicado. */
  matrixSelection = signal<Record<string, string>>({});
  isSavingLineAwards = signal(false);
  isGeneratingSplitOrders = signal(false);

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
    return (
      !!s &&
      ['DRAFT', 'SUBMITTED', 'QUOTING', 'PENDING_APPROVAL', 'PARTIALLY_PURCHASED'].includes(s) &&
      this.canManagePurchases()
    );
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
    if (
      r.status === 'QUOTING' ||
      r.status === 'PENDING_APPROVAL' ||
      r.status === 'PARTIALLY_PURCHASED'
    ) {
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
    return (
      (s === 'QUOTING' || s === 'PENDING_APPROVAL' || s === 'PARTIALLY_PURCHASED') &&
      this.canManagePurchases()
    );
  });

  canSelectWinner = computed(() => {
    const s = this.requisition()?.status;
    if (this.hasLineAwardsSaved()) return false;
    return (s === 'QUOTING' || s === 'PENDING_APPROVAL') && this.canManagePurchases();
  });

  /** Hay adjudicación por ítem persistida (matriz / split). */
  hasLineAwardsSaved = computed(() =>
    (this.requisition()?.items ?? []).some((i) => !!i.awardedQuotationItemId),
  );

  /** Cotizaciones ordenadas para columnas estables de la matriz. */
  quotationsSorted = computed(() => {
    const list = [...(this.requisition()?.quotations ?? [])];
    list.sort((a, b) => {
      const na = (a.vendor?.name ?? a.vendor?.code ?? '').localeCompare(
        b.vendor?.name ?? b.vendor?.code ?? '',
        'es',
      );
      if (na !== 0) return na;
      return a.id.localeCompare(b.id);
    });
    return list;
  });

  /** Mini-dashboard 3-way: líneas SRC vs recepción vs factura (multiproveedor). */
  reconciliationWidget = computed((): {
    snap: RequisitionReconciliationSnapshot;
    denom: number;
    pctInProcurement: number;
    pctReceived: number;
    pctInvoiced: number;
    currency: string;
  } | null => {
    const snap = this.requisition()?.reconciliationSnapshot;
    if (!snap || snap.totalRequisitionLines <= 0) return null;
    const denom = Math.max(snap.totalRequisitionLines, 1);
    const pct = (a: number) =>
      Math.min(100, Math.round(((a / denom) * 1000)) / 10);
    return {
      snap,
      denom: snap.totalRequisitionLines,
      pctInProcurement: pct(snap.linesInProcurement),
      pctReceived: pct(snap.linesFullyReceived),
      pctInvoiced: pct(snap.linesWithInvoice),
      currency: snap.currency ?? 'CLP',
    };
  });

  /** `sourceQuotationItemId` ya cubiertos por una OC activa del requerimiento. */
  activePoSourceQuotationIds = computed(() => {
    const r = this.requisition();
    const set = new Set<string>();
    for (const po of r?.purchaseOrders ?? []) {
      if (PO_INACTIVE.has(po.status)) continue;
      for (const li of po.items ?? []) {
        if (li.sourceQuotationItemId) set.add(li.sourceQuotationItemId);
      }
    }
    return set;
  });

  /** Fila bloqueada: adjudicación ya materializada en OC activa. */
  isAwardRowLocked = (requisitionItemId: string): boolean => {
    const it = this.requisition()?.items?.find((i) => i.id === requisitionItemId);
    const aid = it?.awardedQuotationItemId;
    if (!aid) return false;
    return this.activePoSourceQuotationIds().has(aid);
  };

  /** Cambios locales respecto a lo persistido en el servidor. */
  selectionDirty = computed(() => {
    const r = this.requisition();
    if (!r) return false;
    const sel = this.matrixSelection();
    for (const it of r.items) {
      const local = sel[it.id] ?? null;
      const server = it.awardedQuotationItemId ?? null;
      if (local !== server) return true;
    }
    return false;
  });

  /** Suma cantidad × P.U. de la celda seleccionada (señal). */
  totalAdjudicado = computed(() => {
    const r = this.requisition();
    if (!r) return 0;
    const sel = this.matrixSelection();
    let sum = 0;
    for (const it of r.items) {
      const qLineId = sel[it.id];
      if (!qLineId) continue;
      const line = this.findQuotationItemById(qLineId);
      if (!line) continue;
      sum += Number(line.unitPrice) * Number(it.quantity);
    }
    return sum;
  });

  /** Ítems sin oferta elegida en la matriz (y no bloqueados). */
  hasUnassignedMatrixRows = computed(() => {
    const r = this.requisition();
    if (!r) return false;
    const sel = this.matrixSelection();
    return r.items.some((it) => !sel[it.id] && !this.isAwardRowLocked(it.id));
  });

  /** Quedan líneas adjudicadas sin OC activa (pendiente de generar o completar). */
  hasPendingOcGeneration = computed(() => {
    const r = this.requisition();
    if (!r) return false;
    const bought = this.activePoSourceQuotationIds();
    return r.items.some(
      (it) => !!it.awardedQuotationItemId && !bought.has(it.awardedQuotationItemId!),
    );
  });

  canSaveLineAwards = computed(() => {
    if (!this.canManagePurchases()) return false;
    const s = this.requisition()?.status;
    if (
      !s ||
      !['QUOTING', 'PENDING_APPROVAL', 'PARTIALLY_PURCHASED', 'APPROVED'].includes(
        s,
      )
    ) {
      return false;
    }
    if (!this.selectionDirty()) return false;
    const sel = this.matrixSelection();
    const count = Object.keys(sel).filter((k) => !!sel[k]).length;
    return count > 0;
  });

  canGenerateSplitOrders = computed(() => {
    if (!this.canManagePurchases()) return false;
    if (this.selectionDirty()) return false;
    const s = this.requisition()?.status;
    if (!s) return false;
    if (!this.hasPendingOcGeneration()) return false;
    if (['QUOTING', 'PENDING_APPROVAL', 'PARTIALLY_PURCHASED'].includes(s)) {
      return true;
    }
    if (s === 'APPROVED') {
      return this.hasPendingOcGeneration();
    }
    return false;
  });

  /** Permite cambiar adjudicación en la matriz (no lectura). */
  matrixInteractive = computed(() => {
    if (!this.canManagePurchases()) return false;
    const r = this.requisition();
    const s = r?.status;
    if (!s || !r) return false;
    if (s === 'QUOTING' || s === 'PENDING_APPROVAL' || s === 'PARTIALLY_PURCHASED') {
      return true;
    }
    if (s === 'APPROVED') {
      return r.items.some((it) => !this.isAwardRowLocked(it.id));
    }
    return false;
  });

  poStatusLabel: Record<string, string> = {
    DRAFT: 'Borrador',
    PENDING_APPROVAL: 'Pendiente firma',
    PARTIALLY_APPROVED: 'Firma parcial',
    APPROVED: 'Aprobada',
    REJECTED: 'Rechazada',
    SENT: 'Enviada',
    ORDERED: 'Pedida',
    SENT_TO_SUPPLIER: 'Enviada (hist.)',
    PARTIALLY_RECEIVED: 'Recepción parcial',
    RECEIVED: 'Recibida',
    CLOSED: 'Cerrada',
    CANCELLED: 'Cancelada',
  };

  /** Badges para OC vinculadas (lectura rápida del avance contractual / logístico). */
  poListStatusBadgeClass: Record<string, string> = {
    DRAFT: 'bg-zinc-500/15 text-zinc-300 border border-zinc-500/35',
    PENDING_APPROVAL: 'bg-amber-500/15 text-amber-200 border border-amber-500/40',
    PARTIALLY_APPROVED: 'bg-sky-500/15 text-sky-200 border border-sky-500/35',
    APPROVED: 'bg-emerald-500/15 text-emerald-200 border border-emerald-500/35',
    REJECTED: 'bg-red-500/15 text-red-200 border border-red-500/35',
    SENT: 'bg-indigo-500/15 text-indigo-200 border border-indigo-500/35',
    ORDERED: 'bg-indigo-500/15 text-indigo-200 border border-indigo-500/35',
    SENT_TO_SUPPLIER: 'bg-indigo-500/12 text-indigo-200 border border-indigo-500/30',
    PARTIALLY_RECEIVED: 'bg-cyan-500/15 text-cyan-200 border border-cyan-500/35',
    RECEIVED: 'bg-green-500/15 text-green-200 border border-green-500/35',
    CLOSED: 'bg-slate-500/15 text-slate-200 border border-slate-500/35',
    CANCELLED: 'bg-zinc-600/20 text-zinc-400 border border-zinc-500/30',
  };

  downloadRequisitionPdf(): void {
    const r = this.requisition();
    if (!r) return;
    this.pdfService.generatePurchaseRequisitionSummaryPdf({
      correlative: r.correlative,
      description: r.description,
      status: r.status,
      contract: r.contract,
      subcontract: r.subcontract ?? null,
      items: r.items,
      quotations: r.quotations,
      purchaseOrders: r.purchaseOrders,
    });
  }

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
    return (
      (r.status === 'QUOTING' ||
        r.status === 'PENDING_APPROVAL' ||
        r.status === 'PARTIALLY_PURCHASED') &&
      this.canManagePurchases()
    );
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
        this.syncMatrixSelectionFromServer(data);
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

  private syncMatrixSelectionFromServer(req: PurchaseRequisition) {
    const m: Record<string, string> = {};
    for (const it of req.items) {
      if (it.awardedQuotationItemId) {
        m[it.id] = it.awardedQuotationItemId;
      }
    }
    this.matrixSelection.set(m);
  }

  findQuotationItemById(quotationItemId: string): QuotationItem | undefined {
    for (const q of this.requisition()?.quotations ?? []) {
      const hit = q.items?.find((li) => li.id === quotationItemId);
      if (hit) return hit;
    }
    return undefined;
  }

  getQuotationLineForCell(
    quotation: PurchaseQuotation,
    requisitionItemId: string,
  ): QuotationItem | undefined {
    return quotation.items?.find(
      (li) => li.requisitionItemId === requisitionItemId,
    );
  }

  trackByQuotationId = (_: number, q: PurchaseQuotation) => q.id;
  trackByReqItemId = (_: number, it: { id: string }) => it.id;

  selectMatrixAward(requisitionItemId: string, quotationItemId: string) {
    if (this.isAwardRowLocked(requisitionItemId)) return;
    this.matrixSelection.update((prev) => ({
      ...prev,
      [requisitionItemId]: quotationItemId,
    }));
  }

  matrixCellSubtotal(
    requisitionItemId: string,
    quotationItemId: string | undefined,
  ): number {
    if (!quotationItemId) return 0;
    const line = this.findQuotationItemById(quotationItemId);
    const it = this.requisition()?.items?.find((i) => i.id === requisitionItemId);
    if (!line || !it) return 0;
    return Number(line.unitPrice) * Number(it.quantity);
  }

  saveMatrixSelection() {
    const req = this.requisition();
    if (!req || !this.canSaveLineAwards()) return;
    const sel = this.matrixSelection();
    const awards: LineAward[] = Object.entries(sel)
      .filter(([, quotationItemId]) => !!quotationItemId)
      .map(([requisitionItemId, quotationItemId]) => ({
        requisitionItemId,
        quotationItemId,
      }));
    if (!awards.length) {
      this.notify.warning('Seleccione al menos una oferta en la matriz');
      return;
    }
    this.isSavingLineAwards.set(true);
    this.purchasesService.saveLineAwards(req.id, awards).subscribe({
      next: () => {
        this.notify.success('Adjudicación por línea guardada');
        this.load(req.id);
        this.isSavingLineAwards.set(false);
      },
      error: (err: unknown) => {
        const msg =
          err && typeof err === 'object' && 'error' in err
            ? (err as { error?: { message?: string } }).error?.message
            : undefined;
        this.notify.error(typeof msg === 'string' ? msg : 'Error al guardar adjudicación');
        this.isSavingLineAwards.set(false);
      },
    });
  }

  requestGenerateSplitOrders() {
    if (!this.canGenerateSplitOrders()) return;
    this.showGenerateSplitOrdersModal.set(true);
  }

  cancelGenerateSplitOrders() {
    this.showGenerateSplitOrdersModal.set(false);
  }

  confirmGenerateSplitOrders() {
    this.showGenerateSplitOrdersModal.set(false);
    const req = this.requisition();
    if (!req) return;
    this.isGeneratingSplitOrders.set(true);
    this.purchasesService.createOrdersFromRequisition(req.id).subscribe({
      next: (res) => {
        const n = res.orders?.length ?? 0;
        if (res.idempotent) {
          this.notify.info('No había líneas nuevas que requieran OC; estado actualizado.');
        } else if (n === 1) {
          this.notify.success(`Orden de compra ${res.orders[0]!.correlative} creada`);
        } else {
          this.notify.success(`${n} órdenes de compra creadas`);
        }
        this.load(req.id);
        this.isGeneratingSplitOrders.set(false);
      },
      error: (err: unknown) => {
        const msg =
          err && typeof err === 'object' && 'error' in err
            ? (err as { error?: { message?: string } }).error?.message
            : undefined;
        this.notify.error(typeof msg === 'string' ? msg : 'Error al generar órdenes de compra');
        this.isGeneratingSplitOrders.set(false);
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
    const missingCatalog = req.items.some((it) => !it.inventoryItemId?.trim());
    if (missingCatalog) {
      this.notify.error(
        'Todas las líneas deben estar vinculadas al catálogo maestro. Use «Editar requerimiento» y elija o cree un artículo por línea.',
      );
      return;
    }
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
    if (this.quotationFile && this.quotationFile.size > MAX_UPLOAD_FILE_BYTES) {
      this.notify.warning('El adjunto supera el máximo de 20 MB.');
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







