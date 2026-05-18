import {
  Component,
  signal,
  computed,
  effect,
  inject,
  DestroyRef,
  untracked,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, debounceTime, distinctUntilChanged } from 'rxjs';
import {
  PurchasesService,
  PurchaseOrder,
  PurchaseOrderListQuery,
} from '../../../core/services/purchases/purchases.service';
import { AuthService } from '../../../core/services/auth/auth.service';
import { NotificationService } from '../../../core/services/notification/notification.service';
import { ClpCurrencyPipe } from '../../../shared/pipes/clp-currency.pipe';
import { PurchasesPushNoticeComponent } from '../../../shared/components/purchases-push-notice/purchases-push-notice.component';
import { EntityLinkComponent } from '../../../shared/components/entity-link/entity-link.component';

type PoListSortField =
  | 'createdAt'
  | 'updatedAt'
  | 'correlative'
  | 'status'
  | 'totalAmount'
  | 'sentAt';

@Component({
  selector: 'app-purchase-order-list',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    FormsModule,
    ClpCurrencyPipe,
    PurchasesPushNoticeComponent,
    EntityLinkComponent,
  ],
  templateUrl: './purchase-order-list.component.html',
})
export class PurchaseOrderListComponent {
  private purchasesService = inject(PurchasesService);
  private authService = inject(AuthService);
  private notify = inject(NotificationService);
  private destroyRef = inject(DestroyRef);

  orders = signal<PurchaseOrder[]>([]);
  total = signal(0);
  page = signal(1);
  pageSize = signal(25);
  readonly pageSizeOptions = [10, 25, 50, 100] as const;

  sortField = signal<PoListSortField>('createdAt');
  sortDir = signal<'asc' | 'desc'>('desc');

  isLoading = signal(false);
  statusFilter = signal('');
  showClosedInList = signal(false);

  searchQuery = signal('');
  private search$ = new Subject<string>();

  statusLabels: Record<string, string> = {
    DRAFT: 'Borrador',
    PENDING_APPROVAL: 'Pendiente',
    PARTIALLY_APPROVED: 'Parcial',
    APPROVED: 'Aprobada',
    REJECTED: 'Rechazada',
    SENT: 'Enviada al proveedor',
    ORDERED: 'Pedida al proveedor',
    SENT_TO_SUPPLIER: 'Enviada (hist.)',
    PARTIALLY_RECEIVED: 'Recepción parcial',
    RECEIVED: 'Recibida',
    CLOSED: 'Cerrada',
    CANCELLED: 'Cancelada',
  };

  statusColors: Record<string, string> = {
    DRAFT: 'bg-gray-500/10 text-gray-400',
    PENDING_APPROVAL: 'bg-orange-500/10 text-orange-400',
    PARTIALLY_APPROVED: 'bg-yellow-500/10 text-yellow-400',
    APPROVED: 'bg-green-500/10 text-green-400',
    REJECTED: 'bg-red-500/10 text-red-400',
    SENT: 'bg-blue-500/10 text-blue-400',
    ORDERED: 'bg-blue-500/10 text-blue-400',
    SENT_TO_SUPPLIER: 'bg-blue-500/10 text-blue-400',
    PARTIALLY_RECEIVED: 'bg-purple-500/10 text-purple-400',
    RECEIVED: 'bg-green-500/10 text-green-400',
    CLOSED: 'bg-zinc-500/15 text-zinc-300 border border-zinc-500/30',
    CANCELLED: 'bg-red-500/10 text-red-400',
  };

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

  constructor() {
    this.search$
      .pipe(
        debounceTime(350),
        distinctUntilChanged(),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        this.page.set(1);
        this.loadOrders();
      });

    effect(() => {
      const _cid = this.authService.currentContractId();
      void _cid;
      untracked(() => {
        this.page.set(1);
        this.loadOrders();
      });
    }, { allowSignalWrites: true });
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
    this.loadOrders();
  }

  clearSearch() {
    this.searchQuery.set('');
    this.page.set(1);
    this.loadOrders();
  }

  onStatusFilterChange(value: string) {
    this.statusFilter.set(value);
    this.page.set(1);
    this.loadOrders();
  }

  onShowClosedChange(value: boolean) {
    this.showClosedInList.set(value);
    this.page.set(1);
    this.loadOrders();
  }

  onSortFieldChange(value: string) {
    if (!this.isSortField(value)) return;
    this.sortField.set(value);
    this.page.set(1);
    this.applyDefaultDirForField(value);
    this.loadOrders();
  }

  onSortDirChange(value: string) {
    if (value !== 'asc' && value !== 'desc') return;
    this.sortDir.set(value);
    this.page.set(1);
    this.loadOrders();
  }

  onPageSizeChange(value: unknown) {
    const n = typeof value === 'string' ? parseInt(value, 10) : Number(value);
    if (!Number.isFinite(n) || n < 1) return;
    this.pageSize.set(Math.min(100, n));
    this.page.set(1);
    this.loadOrders();
  }

  prevPage() {
    if (this.page() <= 1) return;
    this.page.update((p) => p - 1);
    this.loadOrders();
  }

  nextPage() {
    if (this.page() >= this.totalPages()) return;
    this.page.update((p) => p + 1);
    this.loadOrders();
  }

  private isSortField(v: string): v is PoListSortField {
    return (
      v === 'createdAt' ||
      v === 'updatedAt' ||
      v === 'correlative' ||
      v === 'status' ||
      v === 'totalAmount' ||
      v === 'sentAt'
    );
  }

  private applyDefaultDirForField(field: string) {
    if (
      field === 'createdAt' ||
      field === 'updatedAt' ||
      field === 'totalAmount' ||
      field === 'sentAt'
    ) {
      this.sortDir.set('desc');
    } else {
      this.sortDir.set('asc');
    }
  }

  private listQueryParams(): PurchaseOrderListQuery {
    const out: PurchaseOrderListQuery = {
      page: this.page(),
      pageSize: this.pageSize(),
      sort: this.sortField(),
      dir: this.sortDir(),
    };
    const cid = this.authService.currentContractId();
    if (cid && cid !== 'ALL') {
      out.contractId = cid;
    }
    const s = this.searchQuery().trim();
    if (s) {
      out.search = s;
    }
    const st = this.statusFilter().trim();
    if (st) {
      out.status = st;
    } else if (this.showClosedInList()) {
      out.includeClosed = true;
    }
    return out;
  }

  loadOrders() {
    this.isLoading.set(true);
    this.purchasesService.getOrders(this.listQueryParams()).subscribe({
      next: (res) => {
        this.orders.set(res.data);
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
        this.notify.error(
          typeof msg === 'string' ? msg : 'Error al cargar órdenes',
        );
        this.isLoading.set(false);
      },
    });
  }
}
