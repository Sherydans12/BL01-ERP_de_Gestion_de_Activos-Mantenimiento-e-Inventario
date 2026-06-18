import {
  Component,
  computed,
  inject,
  signal,
  OnInit,
  OnDestroy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import {
  InventoryItemsService,
  ItemCategory,
} from '../../../core/services/inventory-items/inventory-items.service';
import { NotificationService } from '../../../core/services/notification/notification.service';
import { SkeletonRowComponent } from '../../../shared/components/skeleton-row/skeleton-row.component';
import { ConfirmModalComponent } from '../../../shared/components/confirm-modal/confirm-modal.component';
import {
  CatalogItemDetailModalComponent,
  CatalogItemDetailRow,
} from '../catalog-item-detail-modal/catalog-item-detail-modal.component';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { I } from '../../../core/constants/inventory-permissions';
import {
  Subject,
  Subscription,
  debounceTime,
  distinctUntilChanged,
  finalize,
} from 'rxjs';

@Component({
  selector: 'app-inventory-item-list',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    FormsModule,
    SkeletonRowComponent,
    ConfirmModalComponent,
    CatalogItemDetailModalComponent,
    HasPermissionDirective,
  ],
  templateUrl: './inventory-item-list.component.html',
})
export class InventoryItemListComponent implements OnInit, OnDestroy {
  protected readonly i = I;

  private inventoryItemsService = inject(InventoryItemsService);
  private notificationService = inject(NotificationService);

  /** Solo la página actual (y “cargar más” acumula en la misma vista). */
  items = signal<any[]>([]);
  total = signal(0);
  page = signal(1);
  readonly pageSize = 25;

  isLoading = signal(true);
  isLoadingMore = signal(false);
  isExportingExcel = signal(false);

  searchQuery = signal('');
  private search$ = new Subject<string>();
  private sub = new Subscription();

  filterFamilyId = signal('');
  filterSubcategoryId = signal('');
  families = signal<ItemCategory[]>([]);
  subcategories = signal<ItemCategory[]>([]);

  readonly tableSkeletonRows = Array.from({ length: 8 }, (_, i) => i);

  hasMore = computed(
    () => this.items().length > 0 && this.items().length < this.total(),
  );

  hasActiveFilters = computed(
    () =>
      !!this.searchQuery().trim() ||
      !!this.filterFamilyId() ||
      !!this.filterSubcategoryId(),
  );

  noResults = computed(
    () =>
      !this.isLoading() &&
      this.items().length === 0 &&
      this.total() === 0,
  );

  compatibilityTooltip(item: { compatibilityInfo?: string | null }): string | null {
    const t = String(item?.compatibilityInfo ?? '').trim();
    return t ? `Compatibilidad: ${t}` : null;
  }

  itemDescriptionLabel(item: {
    description?: string | null;
    name?: string | null;
  }): string | null {
    const description = String(item?.description ?? '').trim();
    if (!description) return null;
    const name = String(item?.name ?? '').trim().toLowerCase();
    if (description.toLowerCase() === name) return null;
    return description;
  }

  familiesCatalogReady = signal(false);
  showDeleteConfirmModal = signal(false);
  deleteTarget = signal<{ id: string; codeLabel: string } | null>(null);

  catalogDetailOpen = signal(false);
  catalogDetailLoading = signal(false);
  catalogDetailItem = signal<CatalogItemDetailRow | null>(null);
  catalogDetailError = signal<string | null>(null);

  hasNoCategoryFamilies = computed(
    () => this.familiesCatalogReady() && this.families().length === 0,
  );

  ngOnInit() {
    this.sub.add(
      this.search$
        .pipe(debounceTime(350), distinctUntilChanged())
        .subscribe(() => {
          this.page.set(1);
          this.loadPage(false);
        }),
    );

    this.inventoryItemsService.getCategoryFamilies().subscribe({
      next: (rows) => {
        this.families.set(rows);
        this.familiesCatalogReady.set(true);
      },
      error: () => {
        this.familiesCatalogReady.set(true);
      },
    });
    this.loadPage(false);
  }

  ngOnDestroy() {
    this.sub.unsubscribe();
  }

  onSearchChange(value: string) {
    this.searchQuery.set(value);
    this.search$.next(value.trim());
  }

  /** Lector en mano: Enter ejecuta la búsqueda sin esperar el debounce. */
  onSearchEnter(event: Event) {
    event.preventDefault();
    const v = (event.target as HTMLInputElement).value?.trim() ?? '';
    this.searchQuery.set(v);
    this.page.set(1);
    this.loadPage(false);
  }

  private categoryParam(): string | undefined {
    const sub = this.filterSubcategoryId();
    if (sub) {
      return sub;
    }
    const fam = this.filterFamilyId();
    if (fam) {
      return fam;
    }
    return undefined;
  }

  loadPage(append: boolean) {
    if (append) {
      this.isLoadingMore.set(true);
    } else {
      this.isLoading.set(true);
    }

    this.inventoryItemsService
      .getCatalogPage({
        page: this.page(),
        pageSize: this.pageSize,
        search: this.searchQuery().trim() || undefined,
        categoryId: this.categoryParam(),
      })
      .subscribe({
        next: (res) => {
          this.total.set(res.total);
          if (append) {
            this.items.update((rows) => [...rows, ...res.data]);
          } else {
            this.items.set(res.data);
          }
          this.isLoading.set(false);
          this.isLoadingMore.set(false);
        },
        error: (err) => {
          console.error('Error al cargar artículos', err);
          this.isLoading.set(false);
          this.isLoadingMore.set(false);
        },
      });
  }

  loadMore() {
    if (!this.hasMore() || this.isLoadingMore()) {
      return;
    }
    const maxPage = Math.ceil(this.total() / this.pageSize);
    if (this.page() >= maxPage) {
      return;
    }
    this.page.update((p) => p + 1);
    this.loadPage(true);
  }

  exportMasterExcel() {
    if (this.isExportingExcel()) return;

    this.isExportingExcel.set(true);
    this.inventoryItemsService
      .downloadInventoryMasterExcel()
      .pipe(finalize(() => this.isExportingExcel.set(false)))
      .subscribe({
        next: (blob) => {
          if (!blob?.size) {
            this.notificationService.error('El Excel generado está vacío.');
            return;
          }
          this.downloadBlob(
            blob,
            `BaseLogic_Stock_Inventario_${new Date().toISOString().slice(0, 10)}.xlsx`,
          );
          this.notificationService.success('Excel operativo de stock generado.');
        },
        error: () => {
          this.notificationService.error('No se pudo generar el Excel de inventario.');
        },
      });
  }

  private downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  onFamilySelect(familyId: string) {
    this.filterFamilyId.set(familyId);
    this.filterSubcategoryId.set('');
    this.subcategories.set([]);
    if (!familyId) {
      this.page.set(1);
      this.loadPage(false);
      return;
    }
    this.inventoryItemsService.getCategoryChildren(familyId).subscribe({
      next: (rows) => this.subcategories.set(rows),
      error: () => this.subcategories.set([]),
    });
    this.page.set(1);
    this.loadPage(false);
  }

  onSubcategoryChange(subId: string) {
    this.filterSubcategoryId.set(subId);
    this.page.set(1);
    this.loadPage(false);
  }

  openCatalogDetailFromRow(item: { id: string }) {
    this.catalogDetailOpen.set(true);
    this.catalogDetailLoading.set(true);
    this.catalogDetailItem.set(null);
    this.catalogDetailError.set(null);
    this.inventoryItemsService.getItem(item.id).subscribe({
      next: (row) => {
        this.catalogDetailItem.set(row as CatalogItemDetailRow);
        this.catalogDetailLoading.set(false);
      },
      error: (err) => {
        this.catalogDetailError.set(
          err.error?.message || 'No se pudo cargar el artículo.',
        );
        this.catalogDetailLoading.set(false);
      },
    });
  }

  closeCatalogDetail() {
    this.catalogDetailOpen.set(false);
    this.catalogDetailItem.set(null);
    this.catalogDetailError.set(null);
    this.catalogDetailLoading.set(false);
  }

  deleteItem(
    id: string,
    inventoryCode?: string | null,
    partNumber?: string | null,
  ) {
    const codeLabel =
      String(inventoryCode ?? '').trim() ||
      String(partNumber ?? '').trim() ||
      '—';
    this.deleteTarget.set({ id, codeLabel });
    this.showDeleteConfirmModal.set(true);
  }

  cancelDeleteItem() {
    this.showDeleteConfirmModal.set(false);
    this.deleteTarget.set(null);
  }

  confirmDeleteItem() {
    const target = this.deleteTarget();
    if (!target) return;

    this.inventoryItemsService.deleteItem(target.id).subscribe({
      next: () => {
        this.notificationService.success('Artículo eliminado exitosamente.');
        this.page.set(1);
        this.loadPage(false);
      },
      error: (err) => {
        this.notificationService.error(
          err.error?.message || 'Error al eliminar el artículo.',
        );
      },
      complete: () => {
        this.cancelDeleteItem();
      },
    });
  }
}
