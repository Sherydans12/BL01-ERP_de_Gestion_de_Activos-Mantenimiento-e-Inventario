import {
  Component,
  signal,
  inject,
  OnInit,
  DestroyRef,
  computed,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, debounceTime, distinctUntilChanged } from 'rxjs';
import {
  PurchasesService,
  PurchaseInvoice,
  PurchaseInvoiceListQuery,
} from '../../../core/services/purchases/purchases.service';
import { ContractsService } from '../../../core/services/contracts/contracts.service';
import { NotificationService } from '../../../core/services/notification/notification.service';
import { ClpCurrencyPipe } from '../../../shared/pipes/clp-currency.pipe';
import { Contract } from '../../../core/models/types';
import { PurchasesPushNoticeComponent } from '../../../shared/components/purchases-push-notice/purchases-push-notice.component';
import { EntityLinkComponent } from '../../../shared/components/entity-link/entity-link.component';

type InvoiceListSortField =
  | 'invoiceNumber'
  | 'status'
  | 'emissionDate'
  | 'dueDate'
  | 'totalAmount'
  | 'createdAt'
  | 'updatedAt'
  | 'paidAt'
  | 'poCorrelative'
  | 'vendorName';

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
  private destroyRef = inject(DestroyRef);

  contracts = signal<Contract[]>([]);
  contractId = signal('');
  onlyDiscrepancies = signal(false);
  dueDateFrom = signal('');
  dueDateTo = signal('');

  invoices = signal<PurchaseInvoice[]>([]);
  total = signal(0);
  page = signal(1);
  pageSize = signal(25);
  readonly pageSizeOptions = [10, 25, 50, 100, 200] as const;

  sortField = signal<InvoiceListSortField>('emissionDate');
  sortDir = signal<'asc' | 'desc'>('desc');

  isLoading = signal(false);
  searchQuery = signal('');
  private search$ = new Subject<string>();

  hasActiveSearch = computed(() => !!this.searchQuery().trim());

  totalPages = computed(() =>
    Math.max(1, Math.ceil(this.total() / this.pageSize())),
  );

  rangeFrom = computed(() =>
    this.total() === 0 ? 0 : (this.page() - 1) * this.pageSize() + 1,
  );

  rangeTo = computed(() =>
    Math.min(this.page() * this.pageSize(), this.total()),
  );

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

    this.search$
      .pipe(
        debounceTime(350),
        distinctUntilChanged(),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        this.page.set(1);
        this.load();
      });

    this.load();
  }

  onSearchChange(value: string) {
    this.searchQuery.set(value);
    this.search$.next(value.trim());
  }

  onSearchEnter(event: Event) {
    event.preventDefault();
    const v = (event.target as HTMLInputElement).value?.trim() ?? '';
    this.searchQuery.set(v);
    this.page.set(1);
    this.load();
  }

  clearSearch() {
    this.searchQuery.set('');
    this.page.set(1);
    this.load();
  }

  onSortFieldChange(value: string) {
    if (!this.isSortField(value)) return;
    this.sortField.set(value);
    this.page.set(1);
    this.applyDefaultDirForField(value);
    this.load();
  }

  onSortDirChange(value: string) {
    if (value !== 'asc' && value !== 'desc') return;
    this.sortDir.set(value);
    this.page.set(1);
    this.load();
  }

  onPageSizeChange(value: unknown) {
    const n = typeof value === 'string' ? parseInt(value, 10) : Number(value);
    if (!Number.isFinite(n) || n < 1) return;
    this.pageSize.set(Math.min(500, n));
    this.page.set(1);
    this.load();
  }

  prevPage() {
    if (this.page() <= 1) return;
    this.page.update((p) => p - 1);
    this.load();
  }

  nextPage() {
    if (this.page() >= this.totalPages()) return;
    this.page.update((p) => p + 1);
    this.load();
  }

  private isSortField(v: string): v is InvoiceListSortField {
    return (
      v === 'invoiceNumber' ||
      v === 'status' ||
      v === 'emissionDate' ||
      v === 'dueDate' ||
      v === 'totalAmount' ||
      v === 'createdAt' ||
      v === 'updatedAt' ||
      v === 'paidAt' ||
      v === 'poCorrelative' ||
      v === 'vendorName'
    );
  }

  private applyDefaultDirForField(field: string) {
    if (
      field === 'emissionDate' ||
      field === 'dueDate' ||
      field === 'createdAt' ||
      field === 'updatedAt' ||
      field === 'paidAt' ||
      field === 'totalAmount'
    ) {
      this.sortDir.set('desc');
    } else {
      this.sortDir.set('asc');
    }
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

  applyFilters() {
    this.page.set(1);
    this.syncContractQuery();
    this.load();
  }

  toggleOnlyDiscrepancies() {
    this.onlyDiscrepancies.update((current) => !current);
    this.page.set(1);
    this.load();
  }

  private listQueryParams(): PurchaseInvoiceListQuery {
    const out: PurchaseInvoiceListQuery = {
      page: this.page(),
      pageSize: this.pageSize(),
      sort: this.sortField(),
      dir: this.sortDir(),
    };
    const cid = this.contractId().trim();
    if (cid) out.contractId = cid;
    if (this.onlyDiscrepancies()) out.status = 'DISCREPANCY';
    const df = this.dueDateFrom().trim();
    if (df) out.dueDateFrom = df;
    const dt = this.dueDateTo().trim();
    if (dt) out.dueDateTo = dt;
    const s = this.searchQuery().trim();
    if (s) out.search = s;
    return out;
  }

  load() {
    this.isLoading.set(true);
    this.purchasesService.listPurchaseInvoices(this.listQueryParams()).subscribe({
      next: (res) => {
        this.invoices.set(res.data);
        this.total.set(res.total);
        this.page.set(res.page);
        this.pageSize.set(res.pageSize);
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
}
