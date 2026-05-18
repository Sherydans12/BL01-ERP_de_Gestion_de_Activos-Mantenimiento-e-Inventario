import {
  Component,
  signal,
  computed,
  inject,
  DestroyRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, debounceTime, distinctUntilChanged } from 'rxjs';
import {
  PurchasesService,
  WarehouseReceipt,
  WarehouseReceiptListQuery,
} from '../../../core/services/purchases/purchases.service';
import { NotificationService } from '../../../core/services/notification/notification.service';
import { PurchasesPushNoticeComponent } from '../../../shared/components/purchases-push-notice/purchases-push-notice.component';
import { EntityLinkComponent } from '../../../shared/components/entity-link/entity-link.component';

type ReceiptListSortField =
  | 'correlative'
  | 'status'
  | 'createdAt'
  | 'updatedAt'
  | 'receivedAt'
  | 'poCorrelative'
  | 'warehouseName'
  | 'contractName'
  | 'receivedByName';

@Component({
  selector: 'app-receipt-list',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    FormsModule,
    PurchasesPushNoticeComponent,
    EntityLinkComponent,
  ],
  templateUrl: './receipt-list.component.html',
})
export class ReceiptListComponent {
  private purchasesService = inject(PurchasesService);
  private notify = inject(NotificationService);
  private destroyRef = inject(DestroyRef);

  receipts = signal<WarehouseReceipt[]>([]);
  total = signal(0);
  page = signal(1);
  pageSize = signal(25);
  readonly pageSizeOptions = [10, 25, 50, 100] as const;

  sortField = signal<ReceiptListSortField>('createdAt');
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

  statusLabels: Record<string, string> = {
    PENDING: 'Pendiente',
    PARTIAL: 'Parcial',
    COMPLETED: 'Completa',
  };
  statusColors: Record<string, string> = {
    PENDING: 'bg-yellow-500/10 text-yellow-400',
    PARTIAL: 'bg-orange-500/10 text-orange-400',
    COMPLETED: 'bg-green-500/10 text-green-400',
  };

  constructor() {
    this.search$
      .pipe(
        debounceTime(350),
        distinctUntilChanged(),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => {
        this.page.set(1);
        this.loadReceipts();
      });
    this.loadReceipts();
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
    this.loadReceipts();
  }

  clearSearch() {
    this.searchQuery.set('');
    this.page.set(1);
    this.loadReceipts();
  }

  onSortFieldChange(value: string) {
    if (!this.isSortField(value)) return;
    this.sortField.set(value);
    this.page.set(1);
    this.applyDefaultDirForField(value);
    this.loadReceipts();
  }

  onSortDirChange(value: string) {
    if (value !== 'asc' && value !== 'desc') return;
    this.sortDir.set(value);
    this.page.set(1);
    this.loadReceipts();
  }

  onPageSizeChange(value: unknown) {
    const n = typeof value === 'string' ? parseInt(value, 10) : Number(value);
    if (!Number.isFinite(n) || n < 1) return;
    this.pageSize.set(Math.min(100, n));
    this.page.set(1);
    this.loadReceipts();
  }

  prevPage() {
    if (this.page() <= 1) return;
    this.page.update((p) => p - 1);
    this.loadReceipts();
  }

  nextPage() {
    if (this.page() >= this.totalPages()) return;
    this.page.update((p) => p + 1);
    this.loadReceipts();
  }

  private isSortField(v: string): v is ReceiptListSortField {
    return (
      v === 'correlative' ||
      v === 'status' ||
      v === 'createdAt' ||
      v === 'updatedAt' ||
      v === 'receivedAt' ||
      v === 'poCorrelative' ||
      v === 'warehouseName' ||
      v === 'contractName' ||
      v === 'receivedByName'
    );
  }

  private applyDefaultDirForField(field: string) {
    if (
      field === 'createdAt' ||
      field === 'updatedAt' ||
      field === 'receivedAt'
    ) {
      this.sortDir.set('desc');
    } else {
      this.sortDir.set('asc');
    }
  }

  private listQueryParams(): WarehouseReceiptListQuery {
    const out: WarehouseReceiptListQuery = {
      page: this.page(),
      pageSize: this.pageSize(),
      sort: this.sortField(),
      dir: this.sortDir(),
    };
    const s = this.searchQuery().trim();
    if (s) {
      out.search = s;
    }
    return out;
  }

  loadReceipts() {
    this.isLoading.set(true);
    this.purchasesService.listWarehouseReceipts(this.listQueryParams()).subscribe({
      next: (res) => {
        this.receipts.set(res.data);
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
          typeof msg === 'string' ? msg : 'Error al cargar recepciones',
        );
        this.isLoading.set(false);
      },
    });
  }
}
