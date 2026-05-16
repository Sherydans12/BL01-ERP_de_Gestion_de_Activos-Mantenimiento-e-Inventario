import {
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  OnInit,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import {
  FormBuilder,
  FormGroup,
  Validators,
  ReactiveFormsModule,
} from '@angular/forms';
import { Subject, forkJoin, Observable, debounceTime } from 'rxjs';
import { finalize } from 'rxjs/operators';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { InventoryStockService } from '../../../core/services/inventory-stock/inventory-stock.service';
import { WarehousesService } from '../../../core/services/warehouses/warehouses.service';
import {
  InventoryItemsService,
  ItemCategory,
} from '../../../core/services/inventory-items/inventory-items.service';
import { NotificationService } from '../../../core/services/notification/notification.service';
import { AuthService } from '../../../core/services/auth/auth.service';
import { InventoryAnalyticsService } from '../../../core/services/inventory-analytics/inventory-analytics.service';
import { ExportService } from '../../../core/services/export/export.service';
import { PdfService } from '../../../core/services/pdf/pdf.service';
import { SkeletonRowComponent } from '../../../shared/components/skeleton-row/skeleton-row.component';
import { GlobalItemPickerComponent } from '../../../shared/components/global-item-picker/global-item-picker.component';
import { GLOBAL_ITEM_PICKER_CATALOG } from '../../../shared/components/global-item-picker/global-item-picker.catalog';
import { ItemPickerRow } from '../../../core/services/inventory-items/inventory-items.service';
import { PendingRegularizationModalComponent } from '../pending-regularization-modal/pending-regularization-modal.component';
import type { PendingRegularizationRowDto } from '../pending-regularization-modal/pending-regularization-modal.component';
import { EntityLinkComponent } from '../../../shared/components/entity-link/entity-link.component';
import { ConfirmModalComponent } from '../../../shared/components/confirm-modal/confirm-modal.component';
import { WorkOrdersService } from '../../../core/services/work-orders/work-orders.service';
import {
  CatalogItemDetailModalComponent,
  CatalogItemDetailRow,
} from '../../inventory-items/catalog-item-detail-modal/catalog-item-detail-modal.component';
import {
  PurchasesService,
  type PurchaseOrder,
  type WarehouseReceipt,
} from '../../../core/services/purchases/purchases.service';

@Component({
  selector: 'app-stock-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    RouterLink,
    SkeletonRowComponent,
    GlobalItemPickerComponent,
    PendingRegularizationModalComponent,
    EntityLinkComponent,
    ConfirmModalComponent,
    CatalogItemDetailModalComponent,
  ],
  templateUrl: './stock-dashboard.component.html',
})
export class StockDashboardComponent implements OnInit {
  private injector = inject(Injector);
  private destroyRef = inject(DestroyRef);
  private stockService = inject(InventoryStockService);
  private warehousesService = inject(WarehousesService);
  private itemsService = inject(InventoryItemsService);
  private notificationService = inject(NotificationService);
  private authService = inject(AuthService);
  private analyticsService = inject(InventoryAnalyticsService);
  private exportService = inject(ExportService);
  private pdfService = inject(PdfService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private workOrdersService = inject(WorkOrdersService);
  private purchasesService = inject(PurchasesService);
  private fb = inject(FormBuilder);

  /** Misma configuración base que requerimientos de compra (`GLOBAL_ITEM_PICKER_CATALOG`). */
  readonly itemPickerCatalog = GLOBAL_ITEM_PICKER_CATALOG;

  warehouses = signal<any[]>([]);
  warehousesLoading = signal(true);
  selectedWarehouseId = signal<string>('');

  /** Etiqueta de la bodega seleccionada (código — nombre) para el modal de detalle. */
  selectedWarehouseSummary = computed(() => {
    const id = this.selectedWarehouseId();
    if (!id) return '';
    const w = this.warehouses().find((x: { id: string }) => x.id === id);
    return w ? `${w.code} — ${w.name}` : id;
  });

  stockItems = signal<any[]>([]);
  stockLoading = signal(false);
  families = signal<ItemCategory[]>([]);
  subcategories = signal<ItemCategory[]>([]);
  selectedFamilyId = signal<string>('');
  selectedSubcategoryId = signal<string>('');
  /** Filtro de texto sobre ubicación física (consulta al backend con ILIKE). */
  locationSearch = signal('');
  /**
   * Búsqueda rápida sobre el listado ya cargado (código, N° parte, nombre, QR, etc.).
   * Varios términos separados por espacio: todos deben aparecer (AND) en algún campo del artículo.
   */
  articleQuickSearch = signal('');
  /** Solo filas en o bajo el umbral mínimo (según stock disponible). */
  stockStatusFilter = signal<'all' | 'critical'>('all');
  private locationFilterReload$ = new Subject<void>();
  pendingRegularizationCount = signal<number>(0);
  pendingRegModalOpen = signal(false);

  iraLoading = signal(false);
  iraReport = signal<{
    periodDays: number;
    numerator: number;
    denominator: number;
    iraPercent: number | null;
    note: string;
  } | null>(null);

  /** OT para selector en devolución a bodega. */
  workOrdersForReturn = signal<any[]>([]);

  valuationLoading = signal(false);
  masterReportBusy = signal(false);
  valuationGrandTotal = signal<number>(0);
  valuationByFamily = signal<
    { familyId: string; familyName: string; totalValue: number }[]
  >([]);

  maxFamilyValuation = computed(() => {
    const rows = this.valuationByFamily();
    if (!rows.length) return 1;
    return Math.max(...rows.map((r) => r.totalValue), 1);
  });

  /** Familia / subcategoría (sin filtro “solo críticos”). */
  familyFilteredStockItems = computed(() => {
    const items = this.stockItems();
    const sub = this.selectedSubcategoryId();
    const fam = this.selectedFamilyId();
    if (sub) {
      return items.filter((s: any) => s.item?.categoryId === sub);
    }
    if (fam) {
      return items.filter((s: any) => {
        const ic = s.item?.itemCategory;
        return (
          ic?.parentCategory?.id === fam || ic?.parentCategoryId === fam
        );
      });
    }
    return items;
  });

  /** Tras familia/subcategoría y búsqueda de artículo (sin filtro “solo críticos”). */
  afterFamilyAndArticleFilter = computed(() => {
    const rows = this.familyFilteredStockItems();
    const tokens = this.articleQuickSearchTokens();
    if (!tokens.length) return rows;
    return rows.filter((s: any) => this.stockRowMatchesArticleTokens(s, tokens));
  });

  filteredStockItems = computed(() => {
    let rows = this.afterFamilyAndArticleFilter();
    if (this.stockStatusFilter() === 'critical') {
      rows = rows.filter((s: any) => this.isAvailabilityCritical(s));
    }
    return rows;
  });

  /** Búsqueda de artículo eliminó todas las filas que aún pasaban familia/subcategoría. */
  articleSearchExcludedAll = computed(() => {
    if (!this.articleQuickSearch().trim()) return false;
    return (
      this.familyFilteredStockItems().length > 0 &&
      this.afterFamilyAndArticleFilter().length === 0
    );
  });

  totalItemCount = computed(() => this.filteredStockItems().length);

  totalStockValue = computed(() =>
    this.filteredStockItems().reduce(
      (sum: number, s: any) => sum + s.quantity * Number(s.unitCost || 0),
      0,
    ),
  );

  lowStockAlerts = computed(() =>
    this.familyFilteredStockItems().filter((s: any) =>
      this.isAvailabilityCritical(s),
    ),
  );

  /** Filas placeholder para skeleton de tabla. */
  readonly tableSkeletonRows = Array.from({ length: 8 }, (_, i) => i);

  physicalCountPdfBusy = signal(false);

  showTransactionModal = signal(false);
  showItemPicker = signal(false);
  transactionItemPreview = signal<{ partNumber: string; name: string } | null>(
    null,
  );
  transactionDialog =
    viewChild<ElementRef<HTMLDialogElement>>('transactionDialog');
  adjustDialog =
    viewChild<ElementRef<HTMLDialogElement>>('adjustDialog');
  policyLevelsDialog =
    viewChild<ElementRef<HTMLDialogElement>>('policyLevelsDialog');
  transactionForm: FormGroup;
  adjustmentForm: FormGroup;
  /** Solo mín/máx y ubicación (`updateStockLevels`); sin conteo físico. */
  policyLevelsForm: FormGroup;

  showAdjustModal = signal(false);
  adjustStockRow = signal<any | null>(null);
  showPolicyLevelsModal = signal(false);
  policyLevelsRow = signal<any | null>(null);
  /** OC para ajuste «Saldo pendiente». */
  purchaseOrdersForAdjust = signal<PurchaseOrder[]>([]);
  purchaseOrdersAdjLoading = signal(false);
  receiptsForAdjust = signal<WarehouseReceipt[]>([]);
  receiptsForAdjustLoading = signal(false);
  /** Edición rápida de ubicación en fila (id de item_stock). */
  editingLocationStockId = signal<string | null>(null);
  locationDraft = signal('');
  showAdjustmentConfirmModal = signal(false);
  adjustmentConfirmSummary = signal('');
  adjustmentRiskLevel = signal<'info' | 'warning' | 'danger'>('warning');
  adjustmentConfirmTitle = signal('Confirmar ajuste de inventario');
  adjustmentConfirmMessage = signal(
    '¿Está seguro? Esta acción modificará el stock físico y generará una transacción de ajuste que afectará la valorización de la bodega.',
  );
  adjustmentConfirmButtonText = signal('Sí, aplicar ajuste');

  kardexModalOpen = signal(false);
  kardexLoading = signal(false);
  kardexRows = signal<any[]>([]);
  kardexContext = signal<{
    partNumber: string;
    name: string;
    warehouseLabel: string;
  } | null>(null);
  kardexDialog =
    viewChild<ElementRef<HTMLDialogElement>>('kardexDialog');

  /** Ubicación/saldo actual al elegir ítem en movimiento IN/OUT. */
  transactionStockHint = signal<{
    location: string | null;
    quantityOnHand: number;
  } | null>(null);

  reservationsModalOpen = signal(false);
  reservationsLoading = signal(false);
  reservationRows = signal<
    Array<{
      id: string;
      quantity: number;
      reservedAt: string;
      workOrder: {
        id: string;
        correlative: string;
        responsible: string | null;
        status: string;
      };
    }>
  >([]);
  reservationContext = signal<{ partNumber: string; name: string } | null>(
    null,
  );
  reservationsDialog =
    viewChild<ElementRef<HTMLDialogElement>>('reservationsDialog');

  catalogDetailOpen = signal(false);
  catalogDetailLoading = signal(false);
  catalogDetailItem = signal<CatalogItemDetailRow | null>(null);
  catalogDetailError = signal<string | null>(null);

  constructor() {
    this.transactionForm = this.fb.group({
      /** Operación de almacén (mapea a IN/OUT o navega a transferencias). */
      movementKind: ['PURCHASE_IN', Validators.required],
      itemId: [''],
      workOrderId: [''],
      quantity: [1, [Validators.required, Validators.min(0.01)]],
      unitCost: [0], // Solo para ingresos
      notes: [''],
    });

    this.transactionForm
      .get('movementKind')
      ?.valueChanges.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((k) => {
        if (k === 'RETURN_OT') {
          this.loadWorkOrdersForReturn();
        }
      });

    this.adjustmentForm = this.fb.group({
      newPhysical: [0, [Validators.required, Validators.min(0)]],
      location: [''],
      reason: ['CONTEO', Validators.required],
      comment: ['', [Validators.required, Validators.minLength(2)]],
      purchaseOrderId: [''],
      purchaseReceiptId: [''],
    });

    this.policyLevelsForm = this.fb.group({
      minStock: [0, [Validators.required, Validators.min(0)]],
      maxStock: [0, [Validators.required, Validators.min(0)]],
      location: [''],
    });

    this.adjustmentForm
      .get('reason')
      ?.valueChanges.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((reason: string | null) => {
        const r = reason ?? 'CONTEO';
        this.syncAdjustmentCommentValidators(r);
        this.syncPurchaseReferenceValidators(r);
      });

    this.adjustmentForm
      .get('purchaseOrderId')
      ?.valueChanges.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((po: string | null) => {
        const poTrim = String(po ?? '').trim();
        this.adjustmentForm
          .get('purchaseReceiptId')
          ?.setValue('', { emitEvent: false });
        if (!poTrim) {
          this.receiptsForAdjust.set([]);
          return;
        }
        if (this.adjustmentForm.get('reason')?.value !== 'SALDO_PENDIENTE') {
          return;
        }
        this.receiptsForAdjustLoading.set(true);
        this.purchasesService.getOrder(poTrim).subscribe({
          next: (o) => {
            const wid = this.selectedWarehouseId();
            const list = (o.receipts ?? []).filter((rc) => rc.warehouseId === wid);
            this.receiptsForAdjust.set(list);
            this.receiptsForAdjustLoading.set(false);
          },
          error: () => {
            this.receiptsForAdjust.set([]);
            this.receiptsForAdjustLoading.set(false);
          },
        });
      });

    // Reactividad multifaena
    effect(
      () => {
        const currentContract = this.authService.currentContractId();
        this.loadWarehouses();
        this.selectedWarehouseId.set('');
        this.stockItems.set([]);
        this.selectedFamilyId.set('');
        this.selectedSubcategoryId.set('');
        this.subcategories.set([]);
        this.locationSearch.set('');
        this.articleQuickSearch.set('');
        this.stockStatusFilter.set('all');
        this.loadInventoryValuation();
        this.refreshPendingCount();
      },
      { allowSignalWrites: true },
    );
  }

  ngOnInit() {
    this.locationFilterReload$
      .pipe(debounceTime(350), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        const w = this.selectedWarehouseId();
        if (w) this.loadStock(w);
      });

    this.itemsService.getCategoryFamilies().subscribe({
      next: (rows) => this.families.set(rows),
      error: () => {},
    });
    this.stockService.getPendingCount().subscribe({
      next: (count) => this.pendingRegularizationCount.set(count),
      error: () => this.pendingRegularizationCount.set(0),
    });
  }

  onLocationSearchInput(value: string) {
    this.locationSearch.set(value);
    if (this.selectedWarehouseId()) {
      this.locationFilterReload$.next();
    }
  }

  onArticleQuickSearchInput(value: string) {
    this.articleQuickSearch.set(value);
  }

  onArticleQuickSearchKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && this.articleQuickSearch().trim()) {
      event.preventDefault();
      this.articleQuickSearch.set('');
    }
  }

  clearArticleQuickSearch() {
    this.articleQuickSearch.set('');
  }

  private articleQuickSearchTokens(): string[] {
    return this.articleQuickSearch()
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
  }

  /**
   * Cada token debe coincidir con al menos un campo del artículo (insensible a mayúsculas).
   * UUID: acepta con o sin guiones si el término parece fragmento de UUID.
   */
  private stockRowMatchesArticleTokens(s: any, tokens: string[]): boolean {
    const item = s?.item;
    if (!item) return false;
    const idLower = String(item.id ?? '').toLowerCase();
    const idNoHyphen = idLower.replace(/-/g, '');
    const fieldBlob = [
      item.inventoryCode,
      item.partNumber,
      item.name,
      item.description,
      item.qrCode,
      item.brand,
      item.compatibilityInfo,
      idLower,
    ]
      .map((x: unknown) => String(x ?? '').toLowerCase())
      .join('\u0000');

    return tokens.every((tok) => {
      const t = tok.replace(/\s+/g, '');
      if (!t) return true;
      if (fieldBlob.includes(t)) return true;
      if (idNoHyphen.length && t.replace(/-/g, '').length >= 6) {
        if (idNoHyphen.includes(t.replace(/-/g, ''))) return true;
      }
      return false;
    });
  }

  canSeeValuationReport(): boolean {
    return this.authService.hasRole(['ADMIN', 'SUPERVISOR', 'SUPER_ADMIN']);
  }

  loadInventoryValuation() {
    if (!this.canSeeValuationReport()) {
      this.valuationGrandTotal.set(0);
      this.valuationByFamily.set([]);
      this.valuationLoading.set(false);
      return;
    }
    this.valuationLoading.set(true);
    this.analyticsService.getValuation().subscribe({
      next: (res) => {
        this.valuationGrandTotal.set(res.grandTotal);
        this.valuationByFamily.set(res.byFamily);
        this.valuationLoading.set(false);
      },
      error: () => {
        this.valuationGrandTotal.set(0);
        this.valuationByFamily.set([]);
        this.valuationLoading.set(false);
      },
    });
  }

  canAdjustStock(): boolean {
    return this.authService.hasRole(['ADMIN', 'SUPERVISOR']);
  }

  canSeeStockCosts(): boolean {
    return this.authService.hasRole(['ADMIN', 'SUPERVISOR', 'SUPER_ADMIN']);
  }

  adjustmentDifference(): number | null {
    const row = this.adjustStockRow();
    const raw = this.adjustmentForm.get('newPhysical')?.value;
    if (row == null || raw === null || raw === '') return null;
    const v = Number(raw);
    if (Number.isNaN(v)) return null;
    return v - row.quantity;
  }

  exportValuationExcel() {
    const fam = this.valuationByFamily();
    const data = fam.map((r) => ({
      familia: r.familyName,
      valor: r.totalValue,
    }));
    data.push({
      familia: 'TOTAL',
      valor: this.valuationGrandTotal(),
    });
    this.exportService.exportToExcel(data, 'Valorizacion_inventario', {
      familia: 'Familia (nivel 1)',
      valor: 'Valor (CLP)',
    });
  }

  exportValuationPdf() {
    this.pdfService.generateInventoryValuationPdf(
      this.valuationGrandTotal(),
      this.valuationByFamily(),
    );
  }

  downloadMasterReport(format: 'pdf' | 'xlsx') {
    if (!this.canSeeValuationReport()) {
      this.notificationService.error('No tiene permisos para descargar valorización.');
      return;
    }
    this.masterReportBusy.set(true);
    this.analyticsService.downloadFullReport(format).subscribe({
      next: (blob) => {
        const ext = format === 'pdf' ? 'pdf' : 'xlsx';
        const a = document.createElement('a');
        const url = URL.createObjectURL(blob);
        a.href = url;
        a.download = `valorizacion-maestro.${ext}`;
        a.click();
        URL.revokeObjectURL(url);
        this.masterReportBusy.set(false);
        this.notificationService.success('Reporte descargado.');
      },
      error: () => {
        this.masterReportBusy.set(false);
        this.notificationService.error('No se pudo generar el reporte maestro.');
      },
    });
  }

  openAdjustModal(row: any) {
    if (!this.selectedWarehouseId()) return;
    this.adjustStockRow.set(row);
    this.receiptsForAdjust.set([]);
    this.adjustmentForm.reset({
      newPhysical: row.quantity,
      location: row.location ?? '',
      reason: 'CONTEO',
      comment: '',
      purchaseOrderId: '',
      purchaseReceiptId: '',
    });
    this.syncAdjustmentCommentValidators('CONTEO');
    this.syncPurchaseReferenceValidators('CONTEO');
    this.loadPurchaseOrdersForAdjust();
    this.showAdjustModal.set(true);
    afterNextRender(
      () => {
        const el = this.adjustDialog()?.nativeElement;
        if (el && !el.open) {
          el.showModal();
        }
      },
      { injector: this.injector },
    );
  }

  private loadPurchaseOrdersForAdjust(): void {
    this.purchaseOrdersAdjLoading.set(true);
    this.purchasesService
      .getOrders()
      .pipe(finalize(() => this.purchaseOrdersAdjLoading.set(false)))
      .subscribe({
        next: (rows) => this.purchaseOrdersForAdjust.set(rows),
        error: () => this.purchaseOrdersForAdjust.set([]),
      });
  }

  closeAdjustModal() {
    const el = this.adjustDialog()?.nativeElement;
    if (el?.open) {
      el.close();
    } else {
      this.showAdjustModal.set(false);
      this.adjustStockRow.set(null);
    }
  }

  onAdjustDialogClose() {
    this.showAdjustModal.set(false);
    this.adjustStockRow.set(null);
  }

  openPolicyLevelsModal(row: any) {
    if (!this.selectedWarehouseId()) return;
    this.policyLevelsRow.set(row);
    this.policyLevelsForm.reset({
      minStock: Number(row.minStock ?? 0),
      maxStock: Number(row.maxStock ?? 0),
      location: row.location ?? '',
    });
    this.showPolicyLevelsModal.set(true);
    afterNextRender(
      () => {
        const el = this.policyLevelsDialog()?.nativeElement;
        if (el && !el.open) {
          el.showModal();
        }
      },
      { injector: this.injector },
    );
  }

  closePolicyLevelsModal() {
    const el = this.policyLevelsDialog()?.nativeElement;
    if (el?.open) {
      el.close();
    } else {
      this.showPolicyLevelsModal.set(false);
      this.policyLevelsRow.set(null);
    }
  }

  onPolicyLevelsDialogClose() {
    this.showPolicyLevelsModal.set(false);
    this.policyLevelsRow.set(null);
  }

  submitPolicyLevels() {
    if (this.policyLevelsForm.invalid) {
      this.policyLevelsForm.markAllAsTouched();
      return;
    }
    const row = this.policyLevelsRow();
    const wh = this.selectedWarehouseId();
    if (!row?.item?.id || !wh) return;

    const v = this.policyLevelsForm.getRawValue();
    if (Number(v.maxStock) > 0 && Number(v.maxStock) < Number(v.minStock)) {
      this.notificationService.error(
        'El stock máximo no puede ser menor que el stock mínimo.',
      );
      return;
    }

    const minChanged = Number(v.minStock) !== Number(row.minStock ?? 0);
    const maxChanged = Number(v.maxStock) !== Number(row.maxStock ?? 0);
    const locChanged =
      String(v.location ?? '').trim() !==
      String(row.location ?? '').trim();

    if (!minChanged && !maxChanged && !locChanged) {
      this.notificationService.info(
        'No hay cambios en umbrales ni ubicación.',
      );
      return;
    }

    const payload: {
      minStock?: number;
      maxStock?: number;
      location?: string | null;
    } = {};
    if (minChanged) payload.minStock = Number(v.minStock);
    if (maxChanged) payload.maxStock = Number(v.maxStock);
    if (locChanged) {
      payload.location = String(v.location ?? '').trim() || null;
    }

    this.stockService.updateStockLevels(wh, row.item.id, payload).subscribe({
      next: () => {
        this.notificationService.success(
          'Umbrales y ubicación actualizados en esta bodega.',
        );
        this.closePolicyLevelsModal();
        this.loadStock(wh);
      },
      error: (err) =>
        this.notificationService.error(
          err.error?.message || 'No se pudieron guardar los cambios.',
        ),
    });
  }

  private syncAdjustmentCommentValidators(reason: string) {
    const c = this.adjustmentForm.get('comment');
    if (!c) return;
    if (reason === 'MERMAS' || reason === 'DANO') {
      c.setValidators([
        Validators.required,
        Validators.minLength(15),
      ]);
    } else {
      c.setValidators([
        Validators.required,
        Validators.minLength(2),
      ]);
    }
    c.updateValueAndValidity({ emitEvent: false });
  }

  private syncPurchaseReferenceValidators(reason: string) {
    const po = this.adjustmentForm.get('purchaseOrderId');
    const rc = this.adjustmentForm.get('purchaseReceiptId');
    if (!po || !rc) return;
    if (reason === 'SALDO_PENDIENTE') {
      po.setValidators([Validators.required]);
      rc.setValidators([Validators.required]);
    } else {
      po.clearValidators();
      rc.clearValidators();
      po.setValue('', { emitEvent: false });
      rc.setValue('', { emitEvent: false });
      this.receiptsForAdjust.set([]);
    }
    po.updateValueAndValidity({ emitEvent: false });
    rc.updateValueAndValidity({ emitEvent: false });
  }

  adjustmentCommentHint(): string {
    const r = this.adjustmentForm.get('reason')?.value;
    if (r === 'MERMAS' || r === 'DANO') {
      return 'Obligatorio: mínimo 15 caracteres (pérdida/daño auditable).';
    }
    if (r === 'SALDO_PENDIENTE') {
      return 'Indique OC y recepción de esta bodega; comentario obligatorio (mín. 2 caracteres).';
    }
    return 'Obligatorio para auditoría (mín. 2 caracteres).';
  }

  submitAdjustment() {
    if (this.adjustmentForm.invalid) {
      this.adjustmentForm.markAllAsTouched();
      return;
    }
    const row = this.adjustStockRow();
    const wh = this.selectedWarehouseId();
    if (!row?.item?.id || !wh) return;

    const v = this.adjustmentForm.getRawValue();
    const diff = Number(v.newPhysical) - row.quantity;
    const stockChanged = Math.abs(diff) >= 1e-9;
    const locChanged =
      String(v.location ?? '').trim() !==
      String(row.location ?? '').trim();

    if (!stockChanged && !locChanged) {
      this.notificationService.info(
        'No hay cambios en el stock físico ni en la ubicación.',
      );
      return;
    }

    const itemName = String(row.item?.name ?? 'ítem');
    const pieces: string[] = [];
    if (stockChanged) {
      const diffLabel = `${diff > 0 ? '+' : ''}${diff}`;
      pieces.push(
        `se ajustarán ${diffLabel} unidades de '${itemName}' (saldo final: ${Number(v.newPhysical)})`,
      );
    }
    if (locChanged) {
      pieces.push(`ubicación: "${String(v.location ?? '').trim() || '—'}"`);
    }
    this.adjustmentConfirmSummary.set(
      `Se aplicarán cambios: ${pieces.join(' | ')}. ¿Proceder?`,
    );

    if (stockChanged) {
      this.adjustmentConfirmTitle.set('Confirmar ajuste de inventario');
      this.adjustmentConfirmMessage.set(
        '¿Está seguro? Esta acción modificará el stock físico y generará una transacción de ajuste que afectará la valorización de la bodega.',
      );
      this.adjustmentConfirmButtonText.set('Sí, aplicar ajuste');
      this.adjustmentRiskLevel.set(diff < 0 ? 'danger' : 'warning');
    } else {
      this.adjustmentConfirmTitle.set('Confirmar ubicación en bodega');
      this.adjustmentConfirmMessage.set(
        'Solo se actualizará la ubicación física del ítem en esta bodega. No se registra movimiento de inventario ni ajuste de valorización.',
      );
      this.adjustmentConfirmButtonText.set('Guardar ubicación');
      this.adjustmentRiskLevel.set('info');
    }
    this.showAdjustmentConfirmModal.set(true);
  }

  cancelAdjustmentConfirmation() {
    this.showAdjustmentConfirmModal.set(false);
    this.adjustmentConfirmSummary.set('');
  }

  confirmAdjustment() {
    this.showAdjustmentConfirmModal.set(false);
    if (this.adjustmentForm.invalid) {
      this.adjustmentForm.markAllAsTouched();
      return;
    }
    const row = this.adjustStockRow();
    const wh = this.selectedWarehouseId();
    if (!row?.item?.id || !wh) return;

    const v = this.adjustmentForm.getRawValue();
    const diff = Number(v.newPhysical) - row.quantity;
    const stockChanged = Math.abs(diff) >= 1e-9;
    const locChanged =
      String(v.location ?? '').trim() !==
      String(row.location ?? '').trim();

    const requests: Observable<unknown>[] = [];
    if (locChanged) {
      requests.push(
        this.stockService.updateStockLevels(wh, row.item.id, {
          location: String(v.location ?? '').trim() || null,
        }),
      );
    }

    if (stockChanged) {
      const adjPayload: Parameters<
        InventoryStockService['createPhysicalAdjustment']
      >[0] = {
        warehouseId: wh,
        itemId: row.item.id,
        newPhysicalQuantity: Number(v.newPhysical),
        reason: v.reason as 'MERMAS' | 'CONTEO' | 'DANO' | 'SALDO_PENDIENTE',
        comment: String(v.comment).trim(),
      };
      if (v.reason === 'SALDO_PENDIENTE') {
        adjPayload.purchaseOrderId = String(v.purchaseOrderId ?? '').trim();
        adjPayload.purchaseReceiptId = String(
          v.purchaseReceiptId ?? '',
        ).trim();
      }
      requests.push(this.stockService.createPhysicalAdjustment(adjPayload));
    }

    if (requests.length === 0) {
      this.notificationService.info('No hay cambios para guardar.');
      return;
    }

    const request$ =
      requests.length === 1 ? requests[0] : forkJoin(requests);
    request$.subscribe({
      next: () => {
        const msg = stockChanged
          ? 'Corrección de inventario registrada correctamente.'
          : 'Ubicación en bodega actualizada.';
        this.notificationService.success(msg);
        this.closeAdjustModal();
        this.adjustmentConfirmSummary.set('');
        this.loadInventoryValuation();
        this.loadStock(wh);
      },
      error: (err) =>
        this.notificationService.error(
          err.error?.message || 'No se pudo registrar el ajuste.',
        ),
    });
  }

  familyBarPercent(value: number): number {
    const max = this.maxFamilyValuation();
    if (max <= 0) return 0;
    return Math.round((value / max) * 100);
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

  loadWarehouses() {
    this.warehousesLoading.set(true);
    this.warehousesService.getWarehouses().subscribe({
      next: (data) => {
        this.warehouses.set(data);
        this.warehousesLoading.set(false);
      },
      error: () => {
        this.notificationService.error('Error al cargar bodegas');
        this.warehousesLoading.set(false);
      },
    });
  }

  onFamilyFilterChange(event: Event) {
    const id = (event.target as HTMLSelectElement).value;
    this.selectedFamilyId.set(id);
    this.selectedSubcategoryId.set('');
    this.subcategories.set([]);
    if (!id) return;
    this.itemsService.getCategoryChildren(id).subscribe({
      next: (rows) => this.subcategories.set(rows),
      error: () => this.subcategories.set([]),
    });
  }

  onSubcategoryFilterChange(event: Event) {
    this.selectedSubcategoryId.set(
      (event.target as HTMLSelectElement).value,
    );
  }

  onWarehouseSelect(event: Event) {
    const wId = (event.target as HTMLSelectElement).value;
    this.selectedWarehouseId.set(wId);
    this.selectedFamilyId.set('');
    this.selectedSubcategoryId.set('');
    this.subcategories.set([]);
    this.locationSearch.set('');
    this.articleQuickSearch.set('');
    this.stockStatusFilter.set('all');
    if (wId) {
      this.loadStock(wId);
    } else {
      this.stockItems.set([]);
      this.refreshPendingCount();
    }
  }

  loadStock(warehouseId: string) {
    this.stockLoading.set(true);
    const loc = this.locationSearch().trim();
    this.stockService
      .getStockByWarehouse(warehouseId, loc ? { location: loc } : undefined)
      .subscribe({
      next: (data) => {
        this.stockItems.set(data);
        this.stockLoading.set(false);
        this.refreshPendingCount();
        this.loadInventoryRecordAccuracy(warehouseId);
      },
      error: () => {
        this.notificationService.error('Error al cargar stock');
        this.stockLoading.set(false);
      },
    });
  }

  loadInventoryRecordAccuracy(warehouseId: string) {
    this.iraLoading.set(true);
    this.stockService
      .getInventoryRecordAccuracy({ warehouseId })
      .subscribe({
        next: (r) => {
          this.iraReport.set(r);
          this.iraLoading.set(false);
        },
        error: () => {
          this.iraReport.set(null);
          this.iraLoading.set(false);
        },
      });
  }

  loadWorkOrdersForReturn() {
    const cid = this.authService.currentContractId();
    const req$ =
      cid && cid !== 'ALL'
        ? this.workOrdersService.getWorkOrdersForContract(cid, {
            limit: 400,
          })
        : this.workOrdersService.getWorkOrdersFiltered({ limit: 400 });
    req$.subscribe({
      next: (res: { data: any[] }) =>
        this.workOrdersForReturn.set(res.data ?? []),
      error: () => this.workOrdersForReturn.set([]),
    });
  }

  refreshPendingCount() {
    this.stockService.getPendingCount().subscribe({
      next: (c) => this.pendingRegularizationCount.set(c),
      error: () => this.pendingRegularizationCount.set(0),
    });
  }

  openPendingRegularizationModal() {
    if (this.pendingRegularizationCount() <= 0) return;
    if (!this.selectedWarehouseId()) {
      this.notificationService.info(
        'Seleccione una bodega arriba para ver el detalle de las posiciones pendientes de regularización.',
      );
      return;
    }
    this.pendingRegModalOpen.set(true);
  }

  onPendingModalClosed() {
    this.pendingRegModalOpen.set(false);
    this.refreshPendingCount();
  }

  onPendingOpenAdjust(row: PendingRegularizationRowDto) {
    this.openAdjustModal({
      id: row.itemStockId,
      quantity: row.quantity,
      minStock: 0,
      maxStock: 0,
      unitCost: row.unitCost,
      location: row.location,
      item: row.item,
      bin: row.bin,
    });
  }

  startEditLocation(s: { id: string; location?: string | null }) {
    this.editingLocationStockId.set(s.id);
    this.locationDraft.set(String(s.location ?? '').trim());
  }

  cancelEditLocation() {
    this.editingLocationStockId.set(null);
    this.locationDraft.set('');
  }

  saveEditLocation(s: { id: string; item: { id: string } }) {
    const wh = this.selectedWarehouseId();
    if (!wh) return;
    const v = this.locationDraft().trim();
    this.stockService.updateStockLevels(wh, s.item.id, { location: v || null }).subscribe({
      next: () => {
        this.notificationService.success('Ubicación actualizada.');
        this.cancelEditLocation();
        this.loadStock(wh);
      },
      error: (err) =>
        this.notificationService.error(
          err.error?.message || 'No se pudo guardar la ubicación.',
        ),
    });
  }

  downloadPhysicalCountSheetPdf() {
    const wh = this.selectedWarehouseId();
    if (!wh) {
      this.notificationService.info('Selecciona una bodega primero.');
      return;
    }
    this.physicalCountPdfBusy.set(true);
    this.stockService
      .downloadPhysicalCountSheet(wh)
      .pipe(finalize(() => this.physicalCountPdfBusy.set(false)))
      .subscribe({
        next: (blob) => {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'hoja-conteo-fisico.pdf';
          a.rel = 'noopener';
          a.click();
          URL.revokeObjectURL(url);
          this.notificationService.success('Hoja de conteo físico generada.');
        },
        error: () =>
          this.notificationService.error(
            'No se pudo generar la hoja de conteo físico.',
          ),
      });
  }

  openTransactionModal() {
    if (!this.selectedWarehouseId()) {
      this.notificationService.info('Selecciona una bodega primero.');
      return;
    }
    const devolverOt =
      this.route.snapshot.queryParamMap.get('devolverOt')?.trim() || '';
    this.transactionForm.reset({
      movementKind: devolverOt ? 'RETURN_OT' : 'PURCHASE_IN',
      quantity: 1,
      unitCost: 0,
      itemId: '',
      workOrderId: devolverOt,
      notes: '',
    });
    if (devolverOt) {
      this.loadWorkOrdersForReturn();
    }
    this.transactionItemPreview.set(null);
    this.transactionStockHint.set(null);
    this.showTransactionModal.set(true);
    if (devolverOt) {
      this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { devolverOt: null },
        queryParamsHandling: 'merge',
      });
    }
    afterNextRender(
      () => {
        const el = this.transactionDialog()?.nativeElement;
        if (el && !el.open) {
          el.showModal();
        }
      },
      { injector: this.injector },
    );
  }

  closeTransactionModal() {
    const el = this.transactionDialog()?.nativeElement;
    if (el?.open) {
      el.close();
    } else {
      this.showTransactionModal.set(false);
    }
  }

  onTransactionDialogClose() {
    this.showTransactionModal.set(false);
    this.transactionStockHint.set(null);
  }

  onTransactionItemPicked(row: ItemPickerRow) {
    this.transactionForm.patchValue({ itemId: row.id });
    this.transactionItemPreview.set({
      partNumber: row.partNumber ?? '',
      name: row.name,
    });
    this.showItemPicker.set(false);
    const wh = this.selectedWarehouseId();
    if (wh) {
      this.stockService.getStockPosition(wh, row.id).subscribe({
        next: (pos) => this.transactionStockHint.set(pos),
        error: () => this.transactionStockHint.set(null),
      });
    } else {
      this.transactionStockHint.set(null);
    }
  }

  onTransactionItemPickerClosed() {
    this.showItemPicker.set(false);
  }

  submitTransaction() {
    const wh = this.selectedWarehouseId();
    if (!wh) return;

    const raw = this.transactionForm.getRawValue();
    const kind = raw.movementKind as string;

    if (kind === 'TRANSFER') {
      this.closeTransactionModal();
      this.router.navigate(['/app/inventario/transferencias'], {
        queryParams: { origen: wh },
      });
      return;
    }

    if (kind === 'RETURN_OT') {
      const wo = String(raw.workOrderId ?? '').trim();
      if (!wo) {
        this.notificationService.error('Seleccione la orden de trabajo de origen.');
        return;
      }
      if (!raw.itemId) {
        this.notificationService.error('Seleccione un artículo del catálogo.');
        return;
      }
      if (this.transactionForm.invalid) {
        this.transactionForm.markAllAsTouched();
        return;
      }
      this.stockService
        .performReturn({
          warehouseId: wh,
          itemId: raw.itemId,
          quantity: raw.quantity,
          workOrderId: wo,
          notes: raw.notes || undefined,
        })
        .subscribe({
          next: () => {
            this.notificationService.success('Devolución a bodega registrada.');
            this.closeTransactionModal();
            this.loadStock(wh);
          },
          error: (err) =>
            this.notificationService.error(
              err.error?.message || 'No se pudo registrar la devolución.',
            ),
        });
      return;
    }

    if (!raw.itemId) {
      this.transactionForm.markAllAsTouched();
      this.notificationService.error('Seleccione un artículo del catálogo.');
      return;
    }

    if (this.transactionForm.invalid) {
      this.transactionForm.markAllAsTouched();
      return;
    }

    const type = kind === 'PURCHASE_IN' ? 'IN' : 'OUT';
    const payload = {
      warehouseId: wh,
      itemId: raw.itemId,
      type,
      quantity: raw.quantity,
      unitCost: raw.unitCost,
      notes: raw.notes,
    };

    this.stockService.performTransaction(payload).subscribe({
      next: () => {
        this.notificationService.success('Movimiento registrado exitosamente.');
        this.closeTransactionModal();
        this.loadStock(wh);
      },
      error: (err) =>
        this.notificationService.error(
          err.error?.message || 'Error en la transacción.',
        ),
    });
  }

  /** Stock disponible = físico − reservado (OT no cerradas). */
  stockAvailable(s: {
    quantity: number;
    reservedQuantity?: number;
    availableQuantity?: number;
  }): number {
    if (s.availableQuantity != null && Number.isFinite(s.availableQuantity)) {
      return s.availableQuantity;
    }
    const phys = Number(s.quantity ?? 0);
    const res = Number(s.reservedQuantity ?? 0);
    return phys - res;
  }

  /** Por debajo o en el mínimo (alerta de reposición según disponible). */
  isAvailabilityCritical(s: {
    minStock: number;
    quantity: number;
    reservedQuantity?: number;
    availableQuantity?: number;
  }): boolean {
    const min = Number(s.minStock ?? 0);
    if (min <= 0) return false;
    return this.stockAvailable(s) <= min;
  }

  private approxEq(a: number, b: number): boolean {
    return Math.abs(a - b) < 1e-6;
  }

  stockRowClasses(s: {
    quantity: number;
    minStock: number;
    reservedQuantity?: number;
    availableQuantity?: number;
  }): string {
    const base =
      'hover:bg-dark/40 transition-colors border-l-4 border-solid ';
    const min = Number(s.minStock ?? 0);
    if (min <= 0) {
      return `${base} border-transparent`;
    }
    const avail = this.stockAvailable(s);
    if (avail < min) {
      return `${base} bg-red-950/30 border-red-500`;
    }
    if (this.approxEq(avail, min)) {
      return `${base} bg-amber-950/25 border-amber-500`;
    }
    return `${base} bg-emerald-950/20 border-emerald-600/80`;
  }

  openKardexModal(row: {
    item: { partNumber?: string; name?: string; id: string };
  }) {
    const wh = this.selectedWarehouseId();
    if (!wh) return;
    const w = this.warehouses().find((x) => x.id === wh);
    this.kardexContext.set({
      partNumber: String(row.item?.partNumber ?? ''),
      name: String(row.item?.name ?? ''),
      warehouseLabel: w
        ? `${w.code} — ${w.name}`
        : wh,
    });
    this.kardexModalOpen.set(true);
    this.kardexLoading.set(true);
    this.kardexRows.set([]);
    this.stockService
      .getTransactionsByWarehouse(wh, { itemId: row.item.id })
      .subscribe({
        next: (rows) => {
          this.kardexRows.set(rows ?? []);
          this.kardexLoading.set(false);
        },
        error: () => {
          this.kardexRows.set([]);
          this.kardexLoading.set(false);
          this.notificationService.error('No se pudo cargar el kardex.');
        },
      });
    afterNextRender(
      () => {
        const el = this.kardexDialog()?.nativeElement;
        if (el && !el.open) {
          el.showModal();
        }
      },
      { injector: this.injector },
    );
  }

  closeKardexModal() {
    const el = this.kardexDialog()?.nativeElement;
    if (el?.open) {
      el.close();
    } else {
      this.onKardexDialogClose();
    }
  }

  onKardexDialogClose() {
    this.kardexModalOpen.set(false);
    this.kardexContext.set(null);
    this.kardexRows.set([]);
  }

  openReservationsModal(row: {
    item: { id: string; partNumber?: string; name?: string };
  }) {
    const wh = this.selectedWarehouseId();
    if (!wh || !row?.item?.id) return;
    this.reservationContext.set({
      partNumber: String(row.item.partNumber ?? ''),
      name: String(row.item.name ?? ''),
    });
    this.reservationsModalOpen.set(true);
    this.reservationsLoading.set(true);
    this.reservationRows.set([]);
    this.stockService.listStockReservations(wh, row.item.id).subscribe({
      next: (rows) => {
        this.reservationRows.set(rows ?? []);
        this.reservationsLoading.set(false);
      },
      error: () => {
        this.reservationRows.set([]);
        this.reservationsLoading.set(false);
        this.notificationService.error(
          'No se pudo cargar el desglose de reservas.',
        );
      },
    });
    afterNextRender(
      () => {
        const el = this.reservationsDialog()?.nativeElement;
        if (el && !el.open) {
          el.showModal();
        }
      },
      { injector: this.injector },
    );
  }

  closeReservationsModal() {
    const el = this.reservationsDialog()?.nativeElement;
    if (el?.open) {
      el.close();
    } else {
      this.onReservationsDialogClose();
    }
  }

  onReservationsDialogClose() {
    this.reservationsModalOpen.set(false);
    this.reservationContext.set(null);
    this.reservationRows.set([]);
  }

  canSubmitMovement(): boolean {
    const kind = this.transactionForm.get('movementKind')?.value;
    if (kind === 'TRANSFER') return true;
    const itemId = this.transactionForm.get('itemId')?.value;
    if (kind === 'RETURN_OT') {
      const wo = String(this.transactionForm.get('workOrderId')?.value ?? '').trim();
      return (
        !!itemId &&
        !!wo &&
        this.transactionForm.get('quantity')?.valid === true
      );
    }
    return this.transactionForm.valid && !!itemId;
  }

  openCatalogDetailFromRow(itemId: string) {
    this.catalogDetailOpen.set(true);
    this.catalogDetailLoading.set(true);
    this.catalogDetailItem.set(null);
    this.catalogDetailError.set(null);
    this.itemsService.getItem(itemId).subscribe({
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

  transactionTypeLabel(type: string | undefined): string {
    const m: Record<string, string> = {
      IN: 'Entrada manual',
      OUT: 'Salida manual',
      ADJUST: 'Ajuste',
      RETURN: 'Devolución',
      PURCHASE_RECEIPT: 'Recepción compra',
      WORK_ORDER_ISSUE: 'Consumo OT',
      WORK_ORDER_RETURN: 'Devolución desde OT',
      TRANSFER_OUT: 'Transferencia (envío)',
      TRANSFER_IN: 'Transferencia (recepción)',
    };
    return m[String(type ?? '').toUpperCase()] ?? String(type ?? '—');
  }

  /** Cantidad con signo en kardex por bodega (consumos/salidas negativos). */
  kardexSignedQty(t: { type?: string; quantity?: number }): number {
    const typ = String(t.type ?? '').toUpperCase();
    const q = Number(t.quantity ?? 0);
    switch (typ) {
      case 'TRANSFER_OUT':
      case 'OUT':
      case 'WORK_ORDER_ISSUE':
        return -Math.abs(q);
      case 'TRANSFER_IN':
      case 'IN':
      case 'PURCHASE_RECEIPT':
      case 'RETURN':
      case 'WORK_ORDER_RETURN':
        return Math.abs(q);
      default:
        return q;
    }
  }
}
