import { Component, signal, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { PurchasesService, PurchaseInvoice } from '../../../core/services/purchases/purchases.service';
import { ContractsService } from '../../../core/services/contracts/contracts.service';
import { NotificationService } from '../../../core/services/notification/notification.service';
import { ClpCurrencyPipe } from '../../../shared/pipes/clp-currency.pipe';
import { Contract } from '../../../core/models/types';
import { PurchasesPushNoticeComponent } from '../../../shared/components/purchases-push-notice/purchases-push-notice.component';
import { EntityLinkComponent } from '../../../shared/components/entity-link/entity-link.component';

@Component({
  selector: 'app-purchase-invoice-list',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    FormsModule,
    ClpCurrencyPipe,
    PurchasesPushNoticeComponent,
    EntityLinkComponent,
  ],
  templateUrl: './purchase-invoice-list.component.html',
})
export class PurchaseInvoiceListComponent implements OnInit {
  private purchasesService = inject(PurchasesService);
  private contractsService = inject(ContractsService);
  private notify = inject(NotificationService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  contracts = signal<Contract[]>([]);
  contractId = signal('');
  onlyDiscrepancies = signal(false);
  dueDateFrom = signal('');
  dueDateTo = signal('');
  invoices = signal<PurchaseInvoice[]>([]);
  isLoading = signal(false);

  payDialogOpen = signal(false);
  payTarget = signal<PurchaseInvoice | null>(null);
  paymentRef = signal('');
  paySubmitting = signal(false);

  statusLabels: Record<string, string> = {
    PENDING: 'Pendiente',
    MATCHED: 'Conciliada',
    DISCREPANCY: 'Discrepancia',
    PAID: 'Pagada',
  };

  statusColors: Record<string, string> = {
    PENDING: 'bg-amber-500/10 text-amber-400',
    MATCHED: 'bg-green-500/10 text-green-400',
    DISCREPANCY: 'bg-red-500/10 text-red-400',
    PAID: 'bg-blue-500/10 text-blue-400',
  };

  statusIcons: Record<string, string> = {
    PENDING: '⏳',
    MATCHED: '✓',
    DISCREPANCY: '⚠',
    PAID: '💰',
  };

  /**
   * Semáforo visual por urgencia de vencimiento:
   * rojo (vencida), amarillo (0-7 días), verde (>7 días), neutro (sin fecha/pagada).
   */
  dueSemaphore(inv: PurchaseInvoice): 'red' | 'amber' | 'green' | 'neutral' {
    const days = this.daysUntilDue(inv);
    if (days === null) return 'neutral';
    if (days < 0) return 'red';
    if (days <= 7) return 'amber';
    return 'green';
  }

  dueSemaphoreClass(inv: PurchaseInvoice): string {
    const s = this.dueSemaphore(inv);
    const classes: Record<string, string> = {
      red: 'bg-red-500',
      amber: 'bg-amber-500',
      green: 'bg-emerald-500',
      neutral: 'bg-gray-500',
    };
    return classes[s];
  }

  ngOnInit() {
    this.contractsService.findAll().subscribe({
      next: (c) => this.contracts.set(c),
      error: () => this.contracts.set([]),
    });
    const q = this.route.snapshot.queryParamMap.get('contractId');
    if (q) this.contractId.set(q);
    this.route.queryParamMap.subscribe((p) => {
      const cid = p.get('contractId');
      if (cid) this.contractId.set(cid);
    });
    this.load();
  }

  /** Días hasta vencimiento (UTC fecha); negativo = vencido. */
  daysUntilDue(inv: PurchaseInvoice): number | null {
    if (!inv.dueDate || inv.status === 'PAID') return null;
    const raw = inv.dueDate.slice(0, 10);
    const [y, m, d] = raw.split('-').map(Number);
    const due = new Date(Date.UTC(y, m - 1, d));
    const t = new Date();
    const today = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()));
    return Math.round((due.getTime() - today.getTime()) / 86_400_000);
  }

  openPayDialog(inv: PurchaseInvoice) {
    this.payTarget.set(inv);
    this.paymentRef.set('');
    this.payDialogOpen.set(true);
  }

  closePayDialog() {
    this.payDialogOpen.set(false);
    this.payTarget.set(null);
    this.paymentRef.set('');
    this.paySubmitting.set(false);
  }

  submitPay() {
    const inv = this.payTarget();
    const ref = this.paymentRef().trim();
    if (!inv || !ref) {
      this.notify.error('Ingrese la referencia de pago');
      return;
    }
    this.paySubmitting.set(true);
    this.purchasesService.recordPurchaseInvoicePayment(inv.id, ref).subscribe({
      next: () => {
        this.notify.success('Pago registrado');
        this.closePayDialog();
        this.load();
      },
      error: (err: unknown) => {
        const msg =
          err && typeof err === 'object' && 'error' in err
            ? (err as { error?: { message?: string } }).error?.message
            : undefined;
        this.notify.error(typeof msg === 'string' ? msg : 'Error al registrar pago');
        this.paySubmitting.set(false);
      },
    });
  }

  syncContractQuery() {
    const cid = this.contractId().trim();
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: cid ? { contractId: cid } : { contractId: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  load() {
    this.isLoading.set(true);
    this.purchasesService
      .listPurchaseInvoices({
        ...(this.contractId().trim() ? { contractId: this.contractId() } : {}),
        ...(this.onlyDiscrepancies() ? { status: 'DISCREPANCY' } : {}),
        ...(this.dueDateFrom().trim() ? { dueDateFrom: this.dueDateFrom().trim() } : {}),
        ...(this.dueDateTo().trim() ? { dueDateTo: this.dueDateTo().trim() } : {}),
      })
      .subscribe({
        next: (data) => {
          this.invoices.set(data);
          this.isLoading.set(false);
        },
        error: (err: unknown) => {
          const msg =
            err && typeof err === 'object' && 'error' in err
              ? (err as { error?: { message?: string } }).error?.message
              : undefined;
          this.notify.error(typeof msg === 'string' ? msg : 'Error al cargar facturas');
          this.isLoading.set(false);
        },
      });
  }

  toggleOnlyDiscrepancies() {
    this.onlyDiscrepancies.update((current) => !current);
    this.load();
  }
}
