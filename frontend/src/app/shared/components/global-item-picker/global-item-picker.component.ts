import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  Output,
  SimpleChanges,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, Subscription, debounceTime, distinctUntilChanged } from 'rxjs';
import {
  InventoryItemsService,
  ItemCategory,
  ItemPickerRow,
  QuickCreateItemResult,
} from '../../../core/services/inventory-items/inventory-items.service';
import { QuickAddItemModalComponent } from '../quick-add-item-modal/quick-add-item-modal.component';
import { SkeletonRowComponent } from '../skeleton-row/skeleton-row.component';
import { AuthService } from '../../../core/services/auth/auth.service';
import { I } from '../../../core/constants/inventory-permissions';
import { HasPermissionDirective } from '../../directives/has-permission.directive';

/**
 * Selector modal de artículos usando `<dialog>.showModal()` para quedar por
 * encima de otros modales (p. ej. movimiento de stock en Gestión de Bodegas).
 */
@Component({
  selector: 'app-global-item-picker',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    QuickAddItemModalComponent,
    SkeletonRowComponent,
    HasPermissionDirective,
  ],
  templateUrl: './global-item-picker.component.html',
  styles: [
    `
      dialog.app-global-item-picker-dialog {
        max-width: min(96vw, 56rem);
        width: 100%;
        border: none;
        padding: 0;
        background: transparent;
      }
      dialog.app-global-item-picker-dialog::backdrop {
        background: rgba(0, 0, 0, 0.72);
        backdrop-filter: blur(4px);
      }
    `,
  ],
})
export class GlobalItemPickerComponent
  implements OnInit, OnChanges, AfterViewInit, OnDestroy
{
  protected readonly i = I;

  private itemsService = inject(InventoryItemsService);
  private authService = inject(AuthService);

  @ViewChild('pickerDialog') pickerDialog!: ElementRef<HTMLDialogElement>;

  @Input() open = false;
  @Input() warehouseId: string | null = null;
  @Input() title = 'Catálogo Maestro de Artículos';
  /**
   * Si es true, no se consulta el servidor hasta elegir familia (o escribir búsqueda).
   * Reduce resultados masivos y acota por jerarquía primero.
   */
  @Input() strictFamilyFirst = false;

  /** Familia de catálogo fija (oculta el selector de familia). */
  @Input() lockedFamilyId: string | null = null;

  /** Muestra el flujo «+ Nuevo artículo» (quick-add). Desactivar p. ej. en transferencias W2W. */
  @Input() allowQuickAdd = true;

  /**
   * Con `warehouseId`, limita a artículos con stock físico &gt; 0 en esa bodega.
   * Requiere soporte en API (`onlyWithStock`).
   */
  @Input() onlyWithStockInWarehouse = false;

  /**
   * Con `warehouseId`, limita a ítems con consumo hacia esta OT desde esa bodega
   * y cantidad aún devolvible (API `workOrderId` en el picker).
   */
  @Input() workOrderIdForReturn: string | null = null;

  /**
   * Con `warehouseId`, limita a ítems con saldo neto pendiente de reingreso
   * (salidas `FIELD_DISPATCH` − reingresos `FIELD_RETURN` en kardex).
   */
  @Input() fieldReentryOutstandingOnly = false;

  @Output() closed = new EventEmitter<void>();
  @Output() itemPicked = new EventEmitter<ItemPickerRow>();

  readonly pageSize = 20;

  families = signal<ItemCategory[]>([]);
  subcategories = signal<ItemCategory[]>([]);
  familyId = '';
  subcategoryId = '';

  searchText = '';
  page = signal(1);
  total = signal(0);
  rows = signal<ItemPickerRow[]>([]);
  loading = signal(false);
  quickAddOpen = signal(false);

  private search$ = new Subject<string>();
  private sub = new Subscription();

  ngOnInit() {
    this.sub.add(
      this.search$
        .pipe(debounceTime(300), distinctUntilChanged())
        .subscribe(() => {
          this.page.set(1);
          this.fetch();
        }),
    );
  }

  ngAfterViewInit() {
    this.syncDialogFromInput();
  }

  ngOnChanges(changes: SimpleChanges) {
    queueMicrotask(() => this.syncDialogFromInput());
    if (this.open && this.pickerDialog?.nativeElement?.open) {
      const wh = changes['warehouseId'];
      const ow = changes['onlyWithStockInWarehouse'];
      const wo = changes['workOrderIdForReturn'];
      const fr = changes['fieldReentryOutstandingOnly'];
      if (
        (wh && !wh.firstChange) ||
        (ow && !ow.firstChange) ||
        (wo && !wo.firstChange) ||
        (fr && !fr.firstChange)
      ) {
        this.fetch();
      }
    }
  }

  ngOnDestroy() {
    this.sub.unsubscribe();
  }

  private syncDialogFromInput() {
    const el = this.pickerDialog?.nativeElement;
    if (!el) return;

    if (this.open) {
      if (!el.open) {
        this.resetFilters();
        if (this.lockedFamilyId) {
          this.familyId = this.lockedFamilyId;
          this.itemsService.getCategoryChildren(this.lockedFamilyId).subscribe({
            next: (rows) => this.subcategories.set(rows),
            error: () => this.subcategories.set([]),
          });
          this.families.set([]);
        } else {
          this.itemsService.getCategoryFamilies().subscribe({
            next: (rows) => this.families.set(rows),
            error: () => this.families.set([]),
          });
        }
        el.showModal();
        this.fetch();
      }
    } else if (el.open) {
      el.close();
    }
  }

  onDialogClose() {
    this.closed.emit();
  }

  private resetFilters() {
    this.searchText = '';
    this.familyId = this.lockedFamilyId ?? '';
    this.subcategoryId = '';
    this.subcategories.set([]);
    this.page.set(1);
  }

  onSearchInput(value: string) {
    this.searchText = value;
    this.search$.next(value);
  }

  /** Pistola lectora: Enter dispara búsqueda inmediata y elige si hay un solo resultado. */
  onSearchKeydown(event: KeyboardEvent) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    this.page.set(1);
    this.fetchImmediate();
  }

  private fetchImmediate() {
    const el = this.pickerDialog?.nativeElement;
    if (!el?.open) return;

    const q = this.searchText.trim();
    if (this.strictFamilyFirst && !this.familyId && q.length < 2) {
      return;
    }

    this.loading.set(true);
    this.itemsService
      .getPickerPage({
        search: q || undefined,
        categoryId: this.categoryParam(),
        warehouseId: this.warehouseId?.trim() || undefined,
        onlyWithStockInWarehouse:
          this.onlyWithStockInWarehouse && !!this.warehouseId?.trim(),
        workOrderReturnFilterId:
          this.workOrderIdForReturn?.trim() || undefined,
        fieldReentryOutstanding:
          this.fieldReentryOutstandingOnly &&
          !!this.warehouseId?.trim(),
        page: this.page(),
        pageSize: this.pageSize,
      })
      .subscribe({
        next: (res) => {
          this.rows.set(res.data);
          this.total.set(res.total);
          this.loading.set(false);
          if (res.total === 1 && res.data.length === 1) {
            this.pick(res.data[0]);
          }
        },
        error: () => {
          this.rows.set([]);
          this.total.set(0);
          this.loading.set(false);
        },
      });
  }

  onFamilyChange(id: string) {
    if (this.lockedFamilyId) return;
    this.familyId = id;
    this.subcategoryId = '';
    this.subcategories.set([]);
    if (!this.familyId) {
      this.page.set(1);
      this.fetch();
      return;
    }
    this.itemsService.getCategoryChildren(this.familyId).subscribe({
      next: (rows) => this.subcategories.set(rows),
      error: () => this.subcategories.set([]),
    });
    this.page.set(1);
    this.fetch();
  }

  onSubcategoryChange(id: string) {
    this.subcategoryId = id;
    this.page.set(1);
    this.fetch();
  }

  private categoryParam(): string | undefined {
    if (this.subcategoryId) return this.subcategoryId;
    if (this.familyId) return this.familyId;
    return undefined;
  }

  fetch() {
    const el = this.pickerDialog?.nativeElement;
    if (!el?.open) return;

    const q = this.searchText.trim();
    if (this.strictFamilyFirst && !this.familyId && q.length < 2) {
      this.rows.set([]);
      this.total.set(0);
      this.loading.set(false);
      return;
    }

    this.loading.set(true);
    this.itemsService
      .getPickerPage({
        search: q || undefined,
        categoryId: this.categoryParam(),
        warehouseId: this.warehouseId?.trim() || undefined,
        onlyWithStockInWarehouse:
          this.onlyWithStockInWarehouse && !!this.warehouseId?.trim(),
        workOrderReturnFilterId:
          this.workOrderIdForReturn?.trim() || undefined,
        fieldReentryOutstanding:
          this.fieldReentryOutstandingOnly &&
          !!this.warehouseId?.trim(),
        page: this.page(),
        pageSize: this.pageSize,
      })
      .subscribe({
        next: (res) => {
          this.rows.set(res.data);
          this.total.set(res.total);
          this.loading.set(false);
        },
        error: () => {
          this.rows.set([]);
          this.total.set(0);
          this.loading.set(false);
        },
      });
  }

  totalPages(): number {
    return Math.max(1, Math.ceil(this.total() / this.pageSize));
  }

  prevPage() {
    if (this.page() <= 1) return;
    this.page.update((p) => p - 1);
    this.fetch();
  }

  nextPage() {
    if (this.page() >= this.totalPages()) return;
    this.page.update((p) => p + 1);
    this.fetch();
  }

  pick(row: ItemPickerRow) {
    this.itemPicked.emit(row);
    this.pickerDialog?.nativeElement?.close();
  }

  /** Quick-add solo si el padre lo habilita y el usuario puede crear en catálogo. */
  showQuickAddEntry(): boolean {
    return (
      this.allowQuickAdd && this.authService.hasPermission(I.ITEM_CREATE)
    );
  }

  openQuickAdd() {
    if (!this.showQuickAddEntry()) return;
    this.quickAddOpen.set(true);
  }

  onQuickAddClosed() {
    this.quickAddOpen.set(false);
  }

  onQuickAddCreated(item: QuickCreateItemResult) {
    const row: ItemPickerRow = {
      id: item.id,
      qrCode: item.qrCode,
      partNumber: item.partNumber ?? null,
      name: item.name,
      description: null,
      compatibilityInfo: null,
      unitOfMeasure: item.unitOfMeasure,
      brand: null,
      categoryId: item.categoryId ?? '',
      itemCategory: item.itemCategory ?? {
        id: '',
        name: '',
        parentCategoryId: null,
      },
      stockQuantity: this.warehouseId ? 0 : null,
      stockUnitCost: null,
      stockLocation: null,
    };
    this.quickAddOpen.set(false);
    this.itemPicked.emit(row);
    this.pickerDialog?.nativeElement?.close();
  }

  close() {
    this.pickerDialog?.nativeElement?.close();
  }

  backdropClick(event: MouseEvent) {
    if (event.target === event.currentTarget) {
      this.close();
    }
  }

  familyLabel(cat: ItemCategory): string {
    return cat.parentCategory?.name
      ? `${cat.parentCategory.name} › ${cat.name}`
      : cat.name;
  }

  canSeeUnitCosts(): boolean {
    return this.authService.canViewInventoryCost();
  }
}
