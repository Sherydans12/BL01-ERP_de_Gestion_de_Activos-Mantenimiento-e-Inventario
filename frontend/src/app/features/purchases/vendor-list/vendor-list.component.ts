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
  VendorsService,
  Vendor,
  VendorListQuery,
} from '../../../core/services/vendors/vendors.service';
import { NotificationService } from '../../../core/services/notification/notification.service';
import { ConfirmModalComponent } from '../../../shared/components/confirm-modal/confirm-modal.component';

type VendorListSortField =
  | 'name'
  | 'code'
  | 'createdAt'
  | 'updatedAt'
  | 'rut'
  | 'isActive';

@Component({
  selector: 'app-vendor-list',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, ConfirmModalComponent],
  templateUrl: './vendor-list.component.html',
})
export class VendorListComponent {
  private vendorsService = inject(VendorsService);
  private notify = inject(NotificationService);
  private destroyRef = inject(DestroyRef);

  vendors = signal<Vendor[]>([]);
  total = signal(0);
  page = signal(1);
  pageSize = signal(25);
  readonly pageSizeOptions = [10, 25, 50, 100] as const;

  sortField = signal<VendorListSortField>('name');
  sortDir = signal<'asc' | 'desc'>('asc');

  isLoading = signal(false);
  searchQuery = signal('');
  private search$ = new Subject<string>();
  showInactive = signal(false);

  deactivateModalOpen = signal(false);
  deactivateTarget = signal<Vendor | null>(null);

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
        this.loadVendors();
      });
    this.loadVendors();
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
    this.loadVendors();
  }

  clearSearch() {
    this.searchQuery.set('');
    this.page.set(1);
    this.loadVendors();
  }

  onShowInactiveChange(value: boolean) {
    this.showInactive.set(value);
    this.page.set(1);
    this.loadVendors();
  }

  onSortFieldChange(value: string) {
    if (!this.isSortField(value)) return;
    this.sortField.set(value);
    this.page.set(1);
    this.applyDefaultDirForField(value);
    this.loadVendors();
  }

  onSortDirChange(value: string) {
    if (value !== 'asc' && value !== 'desc') return;
    this.sortDir.set(value);
    this.page.set(1);
    this.loadVendors();
  }

  onPageSizeChange(value: unknown) {
    const n = typeof value === 'string' ? parseInt(value, 10) : Number(value);
    if (!Number.isFinite(n) || n < 1) return;
    this.pageSize.set(Math.min(100, n));
    this.page.set(1);
    this.loadVendors();
  }

  prevPage() {
    if (this.page() <= 1) return;
    this.page.update((p) => p - 1);
    this.loadVendors();
  }

  nextPage() {
    if (this.page() >= this.totalPages()) return;
    this.page.update((p) => p + 1);
    this.loadVendors();
  }

  private isSortField(v: string): v is VendorListSortField {
    return (
      v === 'name' ||
      v === 'code' ||
      v === 'createdAt' ||
      v === 'updatedAt' ||
      v === 'rut' ||
      v === 'isActive'
    );
  }

  private applyDefaultDirForField(field: string) {
    if (field === 'createdAt' || field === 'updatedAt') {
      this.sortDir.set('desc');
    } else if (field === 'isActive') {
      this.sortDir.set('desc');
    } else {
      this.sortDir.set('asc');
    }
  }

  private listQueryParams(): VendorListQuery {
    const out: VendorListQuery = {
      page: this.page(),
      pageSize: this.pageSize(),
      sort: this.sortField(),
      dir: this.sortDir(),
    };
    const s = this.searchQuery().trim();
    if (s) {
      out.search = s;
    }
    if (this.showInactive()) {
      out.includeInactive = true;
    }
    return out;
  }

  loadVendors() {
    this.isLoading.set(true);
    this.vendorsService.listVendors(this.listQueryParams()).subscribe({
      next: (res) => {
        this.vendors.set(res.data);
        this.total.set(res.total);
        this.page.set(res.page);
        this.pageSize.set(res.pageSize);
        this.isLoading.set(false);
      },
      error: () => {
        this.notify.error('Error al cargar proveedores');
        this.isLoading.set(false);
      },
    });
  }

  openDeactivateModal(vendor: Vendor) {
    this.deactivateTarget.set(vendor);
    this.deactivateModalOpen.set(true);
  }

  closeDeactivateModal() {
    this.deactivateModalOpen.set(false);
    this.deactivateTarget.set(null);
  }

  confirmDeactivate() {
    const vendor = this.deactivateTarget();
    if (!vendor) return;
    this.closeDeactivateModal();
    this.vendorsService.remove(vendor.id).subscribe({
      next: () => {
        this.notify.success('Proveedor desactivado');
        this.loadVendors();
      },
      error: () => this.notify.error('Error al desactivar proveedor'),
    });
  }
}
