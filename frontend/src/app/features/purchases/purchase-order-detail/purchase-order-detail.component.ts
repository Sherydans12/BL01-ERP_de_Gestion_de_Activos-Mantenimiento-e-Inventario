import { Component, signal, computed, inject, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute } from '@angular/router';
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

@Component({
  selector: 'app-purchase-order-detail',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, ClpCurrencyPipe, ActivityTimelineComponent],
  templateUrl: './purchase-order-detail.component.html',
})
export class PurchaseOrderDetailComponent implements OnInit, OnDestroy {
  private purchasesService = inject(PurchasesService);
  private authService = inject(AuthService);
  private notify = inject(NotificationService);
  private route = inject(ActivatedRoute);
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

  /** Estados posteriores a la aprobación completa, donde el PDF de la OC suele existir ya. */
  canPreviewPdf = computed(() => {
    const po = this.order();
    if (!po) return false;
    return [
      'APPROVED',
      'SENT_TO_SUPPLIER',
      'PARTIALLY_RECEIVED',
      'RECEIVED',
      'CLOSED',
    ].includes(po.status);
  });

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

  canApprove = computed(() => {
    const po = this.order();
    return po && ['PENDING_APPROVAL', 'PARTIALLY_APPROVED'].includes(po.status);
  });

  canReset = computed(() => {
    const po = this.order();
    return po?.status === 'REJECTED';
  });

  canForceClose = computed(() => {
    const po = this.order();
    return po?.status === 'PARTIALLY_RECEIVED';
  });

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id');
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
    this.purchasesService.getOrder(id).subscribe({
      next: (data) => { this.order.set(data); this.isLoading.set(false); },
      error: () => { this.notify.error('Error al cargar OC'); this.isLoading.set(false); },
    });
    this.purchasesService.getPolicies().subscribe({
      next: (data) => this.policies.set(data),
    });
    this.purchasesService.getOrderActivityLogs(id).subscribe({
      next: (logs) => {
        this.activityLogs.set(logs);
        this.activityLogsLoading.set(false);
      },
      error: () => {
        this.activityLogs.set([]);
        this.activityLogsLoading.set(false);
      },
    });
  }

  approve() {
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

  resetToDraft() {
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
}
