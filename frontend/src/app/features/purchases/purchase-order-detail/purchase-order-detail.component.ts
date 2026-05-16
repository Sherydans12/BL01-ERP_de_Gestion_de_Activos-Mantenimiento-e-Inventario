import { Component, signal, computed, inject, OnInit, OnDestroy, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { switchMap, of, map, catchError } from 'rxjs';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import {
  PurchasesService,
  PurchaseOrder,
  ApprovalPolicy,
  ActivityLogEntry,
} from '../../../core/services/purchases/purchases.service';
import { ActivityTimelineComponent } from '../../../shared/components/activity-timeline/activity-timeline.component';
import { AuthService } from '../../../core/services/auth/auth.service';
import { NotificationService } from '../../../core/services/notification/notification.service';
import { ClpCurrencyPipe } from '../../../shared/pipes/clp-currency.pipe';
import { resolveApprovalPolicyForUser } from '../../../core/utils/approval-policy.util';
import { ConfirmModalComponent } from '../../../shared/components/confirm-modal/confirm-modal.component';
import { PurchasesPushNoticeComponent } from '../../../shared/components/purchases-push-notice/purchases-push-notice.component';
import { PurchasesConceptInfoComponent } from '../../../shared/components/purchases-concept-info/purchases-concept-info.component';
import { GlobalItemPickerComponent } from '../../../shared/components/global-item-picker/global-item-picker.component';
import { GLOBAL_ITEM_PICKER_CATALOG } from '../../../shared/components/global-item-picker/global-item-picker.catalog';
import { ItemPickerRow } from '../../../core/services/inventory-items/inventory-items.service';
import { EquipmentDetailModalComponent } from '../../fleet/equipment-detail-modal/equipment-detail-modal.component';
import { WorkOrderDetailModalComponent } from '../../work-orders/work-order-detail-modal/work-order-detail-modal.component';
import { EntityLinkComponent } from '../../../shared/components/entity-link/entity-link.component';
import { PurchaseDocumentsPanelComponent } from '../../../shared/components/purchase-documents-panel/purchase-documents-panel.component';

@Component({
  selector: 'app-purchase-order-detail',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    FormsModule,
    ClpCurrencyPipe,
    ActivityTimelineComponent,
    ConfirmModalComponent,
    PurchasesPushNoticeComponent,
    PurchasesConceptInfoComponent,
    GlobalItemPickerComponent,
    EquipmentDetailModalComponent,
    WorkOrderDetailModalComponent,
    EntityLinkComponent,
    PurchaseDocumentsPanelComponent,
  ],
  templateUrl: './purchase-order-detail.component.html',
})
export class PurchaseOrderDetailComponent implements OnInit, OnDestroy {
  private purchasesService = inject(PurchasesService);
  private authService = inject(AuthService);
  private notify = inject(NotificationService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);
  private sanitizer = inject(DomSanitizer);

  order = signal<PurchaseOrder | null>(null);
  policies = signal<ApprovalPolicy[]>([]);
  isLoading = signal(true);
  approveComment = signal('');
  rejectReason = signal('');
  showRejectModal = signal(false);
  showCloseModal = signal(false);
  closeReason = signal('');
  showPdfViewer = signal(false);
  pdfUrl = signal<SafeResourceUrl | null>(null);
  pdfLoading = signal(false);
  private blobObjectUrl: string | null = null;
  activityLogs = signal<ActivityLogEntry[]>([]);
  activityLogsLoading = signal(false);
  /** Firma digital/legal: no se puede deshacer desde la UI. */
  showApproveConfirmModal = signal(false);
  /** Reinicio borra firmas y reabre el flujo. */
  showResetConfirmModal = signal(false);
  showCancelOrderModal = signal(false);
  approvalThreshold = signal(0);

  /** Selector del Catálogo Maestro para regularizar líneas sin `inventoryItemId`. */
  showCatalogItemPicker = signal(false);
  poLinkCatalogItemId = signal<string | null>(null);
  isLinkingCatalog = signal(false);

  /** Primera bodega de recepción, para mostrar stock en el picker si existe. */
  pickerWarehouseId = computed(() => {
    const receipts = this.order()?.receipts;
    const wid = receipts?.[0]?.warehouseId;
    return wid && typeof wid === 'string' ? wid : null;
  });

  /** Alineado con control de stock / requerimientos (flags del picker; el título se define en la plantilla). */
  readonly itemPickerCatalog = GLOBAL_ITEM_PICKER_CATALOG;

  /** Pestañas Resumen / Facturación (3-way match). */
  poDetailTab = signal<'summary' | 'billing'>('summary');

  /** Valor recepcionado acumulado (cantidad × costo unitario OC) para match visual. */
  receivedValueTotal = computed(() => {
    const o = this.order();
    if (!o?.receipts?.length) return 0;
    let sum = 0;
    for (const r of o.receipts) {
      if (r.status === 'PENDING') continue;
      for (const ri of r.items ?? []) {
        const u = ri.orderItem?.unitCost ?? 0;
        sum += (ri.quantityReceived ?? 0) * u;
      }
    }
    return sum;
  });

  /** Semáforo 3-way en UI. */
  billingTrafficLight = computed((): 'none' | 'ok' | 'bad' | 'pending' => {
    const inv = this.order()?.purchaseInvoice;
    if (!inv) return 'none';
    if (inv.status === 'MATCHED' || inv.status === 'PAID') return 'ok';
    if (inv.status === 'DISCREPANCY') return 'bad';
    return 'pending';
  });

  /** Motivos de discrepancia (API enriquecida o último match). */
  invoiceDiscrepancyReasons = computed(() => {
    const inv = this.order()?.purchaseInvoice;
    if (!inv || inv.status !== 'DISCREPANCY') return [];
    if (inv.match?.reasons?.length) {
      return inv.match.reasons.filter((r) => r?.trim());
    }
    const fromLog = inv.discrepancyReason
      ?.split(' · ')
      .map((s) => s.trim())
      .filter(Boolean);
    if (fromLog?.length) return fromLog;
    return [
      'Revise el monto facturado frente a la OC y a lo recepcionado en bodega (margen configurado en compras).',
    ];
  });

  readonly conceptThreeWay =
    'Validación automática entre lo pactado (OC), lo recibido (Bodega) y lo cobrado (Factura).';
  readonly conceptOverpay =
    'Monto total de cobros en exceso detectados y corregidos mediante la validación contable.';

  /** Etiquetas de estado de la OC (español técnico). */
  readonly poStatusLabels: Record<string, string> = {
    DRAFT: 'Borrador',
    PENDING_APPROVAL: 'Pendiente de aprobación',
    PARTIALLY_APPROVED: 'Aprobación parcial',
    APPROVED: 'Aprobada',
    REJECTED: 'Rechazada',
    SENT: 'Enviada al proveedor',
    ORDERED: 'Pedida al proveedor',
    SENT_TO_SUPPLIER: 'Enviada al proveedor (hist.)',
    PARTIALLY_RECEIVED: 'Recepción parcial',
    RECEIVED: 'Recepción completa',
    CLOSED: 'Cerrada',
    CANCELLED: 'Anulada',
  };

  poStatusLabel(code: string): string {
    return this.poStatusLabels[code] ?? code;
  }

  deliveryDraft = signal('');
  paymentTermsDraft = signal('');
  savingLogistics = signal(false);

  /** Texto de ayuda: bodega de la primera recepción (referencia de entrega). */
  warehouseDeliveryHint = computed(() => {
    const w = this.order()?.receipts?.[0]?.warehouse;
    if (!w) return null;
    const loc = w.location?.trim();
    return [w.code, w.name, loc].filter(Boolean).join(' · ');
  });

  /** El PDF se genera en servidor con datos actuales (incl. destino equipo/OT); disponible en cualquier estado. */
  canPreviewPdf = computed(() => !!this.order());

  approvalBadges = computed(() => {
    const po = this.order();
    const pols = this.policies();
    if (!po || !pols.length) return [];

    return pols
      .filter(p => p.level <= po.requiredSignatures)
      .map(policy => {
        const approval = po.approvals.find(a => a.level === policy.level);
        return {
          level: policy.level,
          label: policy.description || `Nivel ${policy.level}`,
          status: approval ? 'approved' : 'pending' as 'approved' | 'pending',
          integrity: approval?.integrityStatus ?? null,
          approvedBy: approval?.approvedBy?.name,
          approvedAt: approval?.approvedAt,
        };
      });
  });

  /**
   * Misma lógica que `PurchaseOrdersService.approve`: política del usuario,
   * nivel aún sin firma, y niveles previos completos.
   */
  canApprove = computed(() => {
    const po = this.order();
    const uid = this.authService.currentUser()?.id;
    const user = this.authService.currentUser();
    const pols = this.policies();
    if (!po || !uid || !user) return false;
    if (!['PENDING_APPROVAL', 'PARTIALLY_APPROVED'].includes(po.status)) {
      return false;
    }
    if (po.approvals.some((a) => a.approvedBy?.id === uid)) return false;

    const matchingPolicy = resolveApprovalPolicyForUser(pols, user);
    if (!matchingPolicy) return false;
    if (matchingPolicy.level > po.requiredSignatures) return false;

    const levelTaken = po.approvals.some((a) => a.level === matchingPolicy.level);
    if (levelTaken) return false;

    const signedLevels = new Set(po.approvals.map((a) => a.level));
    const n = matchingPolicy.level;
    for (let level = 1; level < n; level++) {
      if (!signedLevels.has(level)) return false;
    }

    return true;
  });
  approvalConfirmMessage = computed(() => {
    const po = this.order();
    if (!po) return '';
    const amount = Number(po.totalAmount || 0).toLocaleString('es-CL');
    return `Está aprobando una compra por CLP ${amount}. Esta acción es necesaria para habilitar la recepción en bodega. ¿Confirmar aprobación?`;
  });
  requiresExtraApprovalAck = computed(() => {
    const po = this.order();
    if (!po) return false;
    const threshold = Number(this.approvalThreshold() || 0);
    if (threshold <= 0) return false;
    return Number(po.totalAmount) >= threshold && !this.authService.hasRole(['ADMIN', 'SUPER_ADMIN']);
  });
  canCancelOrder = computed(() => {
    const po = this.order();
    if (!po) return false;
    return (
      !['CANCELLED', 'CLOSED', 'RECEIVED'].includes(po.status) &&
      this.authService.hasRole(['ADMIN', 'SUPER_ADMIN', 'SUPERVISOR'])
    );
  });
  requiresExtraCancelAck = computed(
    () => !this.authService.hasRole(['ADMIN', 'SUPER_ADMIN']),
  );

  /** Cotizaciones del mismo requerimiento; la ganadora primero. */
  requisitionQuotations = computed(() => {
    const list = this.order()?.quotation?.requisition?.quotations;
    if (!list?.length) return [];
    return [...list].sort((a, b) => Number(b.isWinner) - Number(a.isWinner));
  });

  quotationStatusLabels: Record<string, string> = {
    RECEIVED: 'Recibida',
    REJECTED: 'Rechazada',
    SELECTED: 'Seleccionada',
  };

  canReset = computed(() => {
    const po = this.order();
    return po?.status === 'REJECTED';
  });

  canForceClose = computed(() => {
    const po = this.order();
    return po?.status === 'PARTIALLY_RECEIVED';
  });

  /**
   * Alineado con `linkItemToCatalog` en backend: solo antes de aprobación final.
   */
  canLinkCatalogOnOrder = computed(() => {
    const po = this.order();
    if (!po) return false;
    if (
      !['DRAFT', 'PENDING_APPROVAL', 'PARTIALLY_APPROVED'].includes(po.status)
    ) {
      return false;
    }
    return this.authService.hasRole(['ADMIN', 'SUPERVISOR', 'SUPER_ADMIN']);
  });

  /**
   * Misma política que el backend (`POST .../sent-to-supplier`): solo en APPROVED;
   * no depende de si ya hay factura (1:1) — el adjunto no cambia el estado de la OC.
   */
  canMarkSentToSupplier = computed(() => {
    const po = this.order();
    if (po?.status !== 'APPROVED') return false;
    return this.authService.hasRole(['ADMIN', 'SUPERVISOR', 'SUPER_ADMIN']);
  });

  isMarkingSentToSupplier = signal(false);

  /** Coherente con `PO_STATUSES_ALLOW_WAREHOUSE_RECEIPT` en backend. */
  private readonly poStatusesAllowReception: readonly string[] = [
    'SENT',
    'ORDERED',
    'PARTIALLY_RECEIVED',
    'SENT_TO_SUPPLIER',
  ];

  /** Alineado con recepción de bodega: solo tras despacho administrativo (SENT / ORDERED / …). */
  canOpenWarehouseReceipt = computed(() => {
    const po = this.order();
    const s = po?.status;
    if (!s || !this.poStatusesAllowReception.includes(s)) {
      return false;
    }
    return this.authService.hasRole(['ADMIN', 'SUPERVISOR', 'SUPER_ADMIN']);
  });

  /** OC aprobada pero aún no enviada: mostrar acceso a recepción deshabilitado con tooltip. */
  canShowDisabledReceptionForApprovedOrder = computed(() => {
    const po = this.order();
    if (po?.status !== 'APPROVED') return false;
    return this.authService.hasRole(['ADMIN', 'SUPERVISOR', 'SUPER_ADMIN']);
  });

  showOverruleThreeWayModal = signal(false);
  overruleThreeWayNotes = signal('');
  isOverrulingThreeWay = signal(false);

  /** Misma gobernanza que `POST .../three-way-match/overrule` en backend. */
  canOverruleShortShipment = computed(() => {
    const inv = this.order()?.purchaseInvoice;
    if (!inv || inv.status !== 'DISCREPANCY') return false;
    if (!this.authService.hasRole(['ADMIN', 'SUPERVISOR'])) return false;
    return inv.match?.matchReceived === true;
  });

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id');
    if (this.route.snapshot.queryParamMap.get('tab') === 'billing') {
      this.poDetailTab.set('billing');
    }
    this.route.queryParamMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((q) => {
        if (q.get('tab') === 'billing') this.poDetailTab.set('billing');
      });
    if (id) this.load(id);
  }

  ngOnDestroy() {
    this.clearPdfBlobUrl();
  }

  togglePdf() {
    if (this.showPdfViewer()) {
      this.clearPdfBlobUrl();
      this.showPdfViewer.set(false);
      this.pdfLoading.set(false);
      return;
    }
    const po = this.order();
    if (!po || !this.canPreviewPdf()) return;

    this.pdfLoading.set(true);
    this.showPdfViewer.set(true);
    this.purchasesService.getOrderPdf(po.id).subscribe({
      next: (blob) => {
        this.clearPdfBlobUrl();
        const url = URL.createObjectURL(blob);
        this.blobObjectUrl = url;
        this.pdfUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(url));
        this.pdfLoading.set(false);
      },
      error: () => {
        this.pdfLoading.set(false);
        this.showPdfViewer.set(false);
        this.notify.error('No se pudo cargar el PDF de la orden');
      },
    });
  }

  private clearPdfBlobUrl() {
    if (this.blobObjectUrl) {
      URL.revokeObjectURL(this.blobObjectUrl);
      this.blobObjectUrl = null;
    }
    this.pdfUrl.set(null);
  }

  load(id: string) {
    this.isLoading.set(true);
    this.activityLogsLoading.set(true);
    this.purchasesService
      .getOrder(id)
      .pipe(
        switchMap((data) => {
          if (!data.purchaseInvoice?.id) {
            return of(data);
          }
          return this.purchasesService.getPurchaseInvoice(data.purchaseInvoice.id).pipe(
            map((inv) => ({
              ...data,
              purchaseInvoice: { ...data.purchaseInvoice!, ...inv },
            })),
            catchError(() => of(data)),
          );
        }),
      )
      .subscribe({
        next: (data) => {
          this.order.set(data);
          this.deliveryDraft.set(data.deliveryAddress ?? '');
          this.paymentTermsDraft.set(data.paymentTerms ?? '');
          this.isLoading.set(false);
        },
        error: (err: unknown) => {
          const msg =
            err && typeof err === 'object' && 'error' in err
              ? (err as { error?: { message?: string } }).error?.message
              : undefined;
          this.notify.error(typeof msg === 'string' ? msg : 'Error al cargar OC');
          this.isLoading.set(false);
        },
      });
    this.purchasesService.getPolicies().subscribe({
      next: (data) => this.policies.set(data),
    });
    this.purchasesService.getSettings().subscribe({
      next: (settings) =>
        this.approvalThreshold.set(Number(settings.approvalThreshold) || 0),
      error: () => this.approvalThreshold.set(0),
    });
    this.purchasesService.getOrderActivityLogs(id).subscribe({
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

  saveLogistics() {
    const o = this.order();
    if (!o) return;
    this.savingLogistics.set(true);
    this.purchasesService
      .patchOrderLogistics(o.id, {
        deliveryAddress: this.deliveryDraft().trim() || null,
        paymentTerms: this.paymentTermsDraft().trim() || null,
      })
      .subscribe({
        next: (d) => {
          this.order.set(d);
          this.deliveryDraft.set(d.deliveryAddress ?? '');
          this.paymentTermsDraft.set(d.paymentTerms ?? '');
          this.notify.success('Datos de entrega y condición de pago guardados.');
          this.savingLogistics.set(false);
        },
        error: (err: unknown) => {
          const msg =
            err && typeof err === 'object' && 'error' in err
              ? (err as { error?: { message?: string } }).error?.message
              : undefined;
          this.notify.error(typeof msg === 'string' ? msg : 'No se pudo guardar.');
          this.savingLogistics.set(false);
        },
      });
  }

  requestApprove() {
    this.showApproveConfirmModal.set(true);
  }

  cancelApproveConfirm() {
    this.showApproveConfirmModal.set(false);
  }

  confirmApprove() {
    this.showApproveConfirmModal.set(false);
    const po = this.order();
    if (!po) return;
    this.purchasesService.approveOrder(po.id, this.approveComment() || undefined).subscribe({
      next: () => {
        this.notify.success('Firma registrada exitosamente');
        this.approveComment.set('');
        this.load(po.id);
      },
      error: (err: any) => this.notify.error(err?.error?.message || 'Error al firmar'),
    });
  }

  requestCancelOrder() {
    if (!this.canCancelOrder()) return;
    this.showCancelOrderModal.set(true);
  }

  cancelCancelOrderModal() {
    this.showCancelOrderModal.set(false);
  }

  confirmCancelOrder(reason: string | null) {
    const po = this.order();
    if (!po) return;
    const cancelReason = reason?.trim();
    if (!cancelReason) {
      this.notify.error('Debe ingresar un motivo de anulación');
      return;
    }
    this.showCancelOrderModal.set(false);
    this.purchasesService.cancelOrder(po.id, cancelReason).subscribe({
      next: () => {
        this.notify.success('OC anulada');
        this.load(po.id);
      },
      error: (err: any) => this.notify.error(err?.error?.message || 'Error al anular OC'),
    });
  }

  openRejectModal() {
    this.rejectReason.set('');
    this.showRejectModal.set(true);
  }

  confirmReject() {
    const po = this.order();
    if (!po) return;
    this.purchasesService.rejectOrder(po.id, this.rejectReason() || 'Rechazada por aprobador').subscribe({
      next: () => {
        this.notify.success('OC rechazada');
        this.showRejectModal.set(false);
        this.load(po.id);
      },
      error: () => this.notify.error('Error al rechazar'),
    });
  }

  requestResetToDraft() {
    this.showResetConfirmModal.set(true);
  }

  cancelResetConfirm() {
    this.showResetConfirmModal.set(false);
  }

  confirmResetToDraft() {
    this.showResetConfirmModal.set(false);
    const po = this.order();
    if (!po) return;
    this.purchasesService.resetOrder(po.id).subscribe({
      next: () => {
        this.notify.success('OC reiniciada a borrador');
        this.load(po.id);
      },
      error: (err: any) => this.notify.error(err?.error?.message || 'Error al reiniciar'),
    });
  }

  openCloseModal() {
    this.closeReason.set('');
    this.showCloseModal.set(true);
  }

  setPoTab(tab: 'summary' | 'billing') {
    this.poDetailTab.set(tab);
    const id = this.order()?.id;
    if (!id) return;
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab: tab === 'billing' ? 'billing' : null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  revalidateInvoice() {
    const inv = this.order()?.purchaseInvoice;
    const oid = this.order()?.id;
    if (!inv || !oid) return;
    this.purchasesService.validatePurchaseInvoice(inv.id).subscribe({
      next: () => {
        this.notify.success('Validación 3-way actualizada');
        this.load(oid);
      },
      error: (err: unknown) => {
        const msg =
          err && typeof err === 'object' && 'error' in err
            ? (err as { error?: { message?: string } }).error?.message
            : undefined;
        this.notify.error(typeof msg === 'string' ? msg : 'Error al validar');
      },
    });
  }

  openOverruleThreeWayModal() {
    this.overruleThreeWayNotes.set('');
    this.showOverruleThreeWayModal.set(true);
  }

  cancelOverruleThreeWayModal() {
    this.showOverruleThreeWayModal.set(false);
  }

  confirmOverruleThreeWay() {
    const notes = this.overruleThreeWayNotes().trim();
    if (notes.length < 15) {
      this.notify.error('La justificación debe tener al menos 15 caracteres.');
      return;
    }
    const inv = this.order()?.purchaseInvoice;
    const oid = this.order()?.id;
    if (!inv?.id || !oid) return;
    this.isOverrulingThreeWay.set(true);
    this.purchasesService.overrulePurchaseInvoiceThreeWayMatch(inv.id, notes).subscribe({
      next: () => {
        this.notify.success('Discrepancia aceptada: factura conciliada con excepción registrada.');
        this.showOverruleThreeWayModal.set(false);
        this.isOverrulingThreeWay.set(false);
        this.load(oid);
      },
      error: (err: unknown) => {
        this.isOverrulingThreeWay.set(false);
        const msg =
          err && typeof err === 'object' && 'error' in err
            ? (err as { error?: { message?: string } }).error?.message
            : undefined;
        this.notify.error(typeof msg === 'string' ? msg : 'Error al autorizar excepción');
      },
    });
  }

  markInvoicePaid() {
    const inv = this.order()?.purchaseInvoice;
    const oid = this.order()?.id;
    if (!inv || !oid) return;
    this.purchasesService.markPurchaseInvoicePaid(inv.id).subscribe({
      next: () => {
        this.notify.success('Factura marcada como pagada');
        this.load(oid);
      },
      error: (err: unknown) => {
        const msg =
          err && typeof err === 'object' && 'error' in err
            ? (err as { error?: { message?: string } }).error?.message
            : undefined;
        this.notify.error(typeof msg === 'string' ? msg : 'Error al registrar pago');
      },
    });
  }

  confirmForceClose() {
    const po = this.order();
    if (!po || !this.closeReason().trim()) {
      this.notify.error('Debe ingresar una justificación');
      return;
    }
    this.purchasesService.forceCloseOrder(po.id, this.closeReason()).subscribe({
      next: () => {
        this.notify.success('Orden cerrada administrativamente');
        this.showCloseModal.set(false);
        this.load(po.id);
      },
      error: (err: any) => this.notify.error(err?.error?.message || 'Error al cerrar orden'),
    });
  }

  markSentToSupplier() {
    const po = this.order();
    if (!po) return;
    this.isMarkingSentToSupplier.set(true);
    this.purchasesService.markOrderSentToSupplier(po.id).subscribe({
      next: () => {
        this.notify.success('Orden marcada como enviada al proveedor');
        this.isMarkingSentToSupplier.set(false);
        this.load(po.id);
      },
      error: (err: unknown) => {
        const msg =
          err && typeof err === 'object' && 'error' in err
            ? (err as { error?: { message?: string } }).error?.message
            : undefined;
        this.notify.error(typeof msg === 'string' ? msg : 'Error al actualizar estado');
        this.isMarkingSentToSupplier.set(false);
      },
    });
  }

  openLinkCatalogModal(orderItemId: string) {
    this.poLinkCatalogItemId.set(orderItemId);
    this.showCatalogItemPicker.set(true);
  }

  onCatalogItemPicked(item: ItemPickerRow) {
    const oid = this.order()?.id;
    const lineId = this.poLinkCatalogItemId();
    if (!oid || !lineId) return;
    this.showCatalogItemPicker.set(false);
    this.isLinkingCatalog.set(true);
    this.purchasesService.linkOrderItemToCatalog(oid, lineId, item.id).subscribe({
      next: () => {
        this.notify.success('Línea vinculada al Catálogo Maestro de Artículos');
        this.isLinkingCatalog.set(false);
        this.poLinkCatalogItemId.set(null);
        this.load(oid);
      },
      error: (err: unknown) => {
        const msg =
          err && typeof err === 'object' && 'error' in err
            ? (err as { error?: { message?: string } }).error?.message
            : undefined;
        this.notify.error(typeof msg === 'string' ? msg : 'No se pudo vincular al catálogo');
        this.isLinkingCatalog.set(false);
      },
    });
  }

  onCatalogPickerClosed() {
    this.showCatalogItemPicker.set(false);
    this.poLinkCatalogItemId.set(null);
  }

  showLinkedEquipmentModal = signal(false);
  linkedEquipmentDetailId = signal<string | null>(null);
  showLinkedOtModal = signal(false);
  linkedOtDetailId = signal<string | null>(null);

  openLinkedEquipmentModal(): void {
    const o = this.order();
    const id = o?.equipment?.id ?? o?.equipmentId ?? null;
    if (!id) return;
    this.linkedEquipmentDetailId.set(id);
    this.showLinkedEquipmentModal.set(true);
  }

  closeLinkedEquipmentModal(): void {
    this.showLinkedEquipmentModal.set(false);
    this.linkedEquipmentDetailId.set(null);
  }

  openLinkedOtModal(): void {
    const o = this.order();
    const id = o?.workOrder?.id ?? o?.workOrderId ?? null;
    if (!id) return;
    this.linkedOtDetailId.set(id);
    this.showLinkedOtModal.set(true);
  }

  closeLinkedOtModal(): void {
    this.showLinkedOtModal.set(false);
    this.linkedOtDetailId.set(null);
  }
}
