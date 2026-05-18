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
  PurchaseRequisition,
  PurchaseRequisitionListQuery,
} from '../../../core/services/purchases/purchases.service';
import { AuthService } from '../../../core/services/auth/auth.service';
import { NotificationService } from '../../../core/services/notification/notification.service';
import { PurchasesPushNoticeComponent } from '../../../shared/components/purchases-push-notice/purchases-push-notice.component';
import { EntityLinkComponent } from '../../../shared/components/entity-link/entity-link.component';

type RequisitionListSortField =
  | 'createdAt'
  | 'updatedAt'
  | 'correlative'
  | 'description'
  | 'status'
  | 'priority';

@Component({
  selector: 'app-requisition-list',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    FormsModule,
    PurchasesPushNoticeComponent,
    EntityLinkComponent,
  ],
  templateUrl: './requisition-list.component.html',
})
export class RequisitionListComponent {
  private purchasesService = inject(PurchasesService);
  private authService = inject(AuthService);
  private notify = inject(NotificationService);
  private destroyRef = inject(DestroyRef);

  requisitions = signal<PurchaseRequisition[]>([]);
  total = signal(0);
  page = signal(1);
  pageSize = signal(25);
  readonly pageSizeOptions = [10, 25, 50, 100] as const;

  sortField = signal<RequisitionListSortField>('createdAt');
  sortDir = signal<'asc' | 'desc'>('desc');

  isLoading = signal(false);
  statusFilter = signal('');
  /** Si false, el backend excluye `CLOSED` cuando el estado es «todos». */
  showClosedInList = signal(false);

  searchQuery = signal('');
  private search$ = new Subject<string>();

  statusLabels: Record<string, string> = {
    DRAFT: 'Borrador',
    SUBMITTED: 'Enviado',
    QUOTING: 'En Cotización',
    PENDING_APPROVAL: 'Pendiente Aprobación',
    PARTIALLY_PURCHASED: 'Compra parcial',
    APPROVED: 'Aprobado',
    REJECTED: 'Rechazado',
    CANCELLED: 'Cancelado',
    CLOSED: 'Cerrado (completo)',
  };

  statusColors: Record<string, string> = {
    DRAFT: 'bg-gray-500/10 text-gray-400',
    SUBMITTED: 'bg-blue-500/10 text-blue-400',
    QUOTING: 'bg-yellow-500/10 text-yellow-400',
    PENDING_APPROVAL: 'bg-orange-500/10 text-orange-400',
    PARTIALLY_PURCHASED: 'bg-cyan-500/12 text-cyan-300 border border-cyan-500/35',
    APPROVED: 'bg-green-500/10 text-green-400',
    REJECTED: 'bg-red-500/10 text-red-400',
    CANCELLED: 'bg-red-500/10 text-red-400',
    CLOSED: 'bg-zinc-500/15 text-zinc-300 border border-zinc-500/30',
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
        this.loadRequisitions();
      });

    effect(() => {
      const _cid = this.authService.currentContractId();
      void _cid;
      untracked(() => {
        this.page.set(1);
        this.loadRequisitions();
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
    this.loadRequisitions();
  }

  clearSearch() {
    this.searchQuery.set('');
    this.page.set(1);
    this.loadRequisitions();
  }

  onStatusFilterChange(value: string) {
    this.statusFilter.set(value);
    this.page.set(1);
    this.loadRequisitions();
  }

  onShowClosedChange(value: boolean) {
    this.showClosedInList.set(value);
    this.page.set(1);
    this.loadRequisitions();
  }

  onSortFieldChange(value: string) {
    if (!this.isSortField(value)) return;
    this.sortField.set(value);
    this.page.set(1);
    this.applyDefaultDirForField(value);
    this.loadRequisitions();
  }

  onSortDirChange(value: string) {
    if (value !== 'asc' && value !== 'desc') return;
    this.sortDir.set(value);
    this.page.set(1);
    this.loadRequisitions();
  }

  onPageSizeChange(value: unknown) {
    const n = typeof value === 'string' ? parseInt(value, 10) : Number(value);
    if (!Number.isFinite(n) || n < 1) return;
    this.pageSize.set(Math.min(100, n));
    this.page.set(1);
    this.loadRequisitions();
  }

  prevPage() {
    if (this.page() <= 1) return;
    this.page.update((p) => p - 1);
    this.loadRequisitions();
  }

  nextPage() {
    if (this.page() >= this.totalPages()) return;
    this.page.update((p) => p + 1);
    this.loadRequisitions();
  }

  private isSortField(v: string): v is RequisitionListSortField {
    return (
      v === 'createdAt' ||
      v === 'updatedAt' ||
      v === 'correlative' ||
      v === 'description' ||
      v === 'status' ||
      v === 'priority'
    );
  }

  /** Alineado con defaults del backend al cambiar campo. */
  private applyDefaultDirForField(field: string) {
    if (field === 'createdAt' || field === 'updatedAt') {
      this.sortDir.set('desc');
    } else {
      this.sortDir.set('asc');
    }
  }

  private listQueryParams(): PurchaseRequisitionListQuery {
    const out: PurchaseRequisitionListQuery = {
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

  loadRequisitions() {
    this.isLoading.set(true);
    this.purchasesService.getRequisitions(this.listQueryParams()).subscribe({
      next: (res) => {
        this.requisitions.set(res.data);
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
          typeof msg === 'string' ? msg : 'Error al cargar requerimientos',
        );
        this.isLoading.set(false);
      },
    });
  }
}
