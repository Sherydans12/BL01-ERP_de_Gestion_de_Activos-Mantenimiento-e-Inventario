import {
  Component,
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
import { CommonModule } from '@angular/common';
import {
  FormBuilder,
  FormGroup,
  Validators,
  ReactiveFormsModule,
} from '@angular/forms';
import { forkJoin, Observable } from 'rxjs';
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
import { ItemPickerRow } from '../../../core/services/inventory-items/inventory-items.service';
import { PendingRegularizationModalComponent } from '../pending-regularization-modal/pending-regularization-modal.component';
import type { PendingRegularizationRowDto } from '../pending-regularization-modal/pending-regularization-modal.component';
import { EntityLinkComponent } from '../../../shared/components/entity-link/entity-link.component';
import { ConfirmModalComponent } from '../../../shared/components/confirm-modal/confirm-modal.component';

@Component({
  selector: 'app-stock-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    SkeletonRowComponent,
    GlobalItemPickerComponent,
    PendingRegularizationModalComponent,
    EntityLinkComponent,
    ConfirmModalComponent,
  ],
  templateUrl: './stock-dashboard.component.html',
})
export class StockDashboardComponent implements OnInit {
  private injector = inject(Injector);
  private stockService = inject(InventoryStockService);
  private warehousesService = inject(WarehousesService);
  private itemsService = inject(InventoryItemsService);
  private notificationService = inject(NotificationService);
  private authService = inject(AuthService);
  private analyticsService = inject(InventoryAnalyticsService);
  private exportService = inject(ExportService);
  private pdfService = inject(PdfService);
  private fb = inject(FormBuilder);

  warehouses = signal<any[]>([]);
  warehousesLoading = signal(true);
  selectedWarehouseId = signal<string>('');

  stockItems = signal<any[]>([]);
  stockLoading = signal(false);
  families = signal<ItemCategory[]>([]);
  subcategories = signal<ItemCategory[]>([]);
  selectedFamilyId = signal<string>('');
  selectedSubcategoryId = signal<string>('');
  pendingRegularizationCount = signal<number>(0);
  pendingRegModalOpen = signal(false);

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

  filteredStockItems = computed(() => {
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

  totalItemCount = computed(() => this.filteredStockItems().length);

  totalStockValue = computed(() =>
    this.filteredStockItems().reduce(
      (sum: number, s: any) => sum + s.quantity * Number(s.unitCost || 0),
      0,
    ),
  );

  lowStockAlerts = computed(() =>
    this.filteredStockItems().filter(
      (s: any) => s.minStock > 0 && s.quantity <= s.minStock,
    ),
  );

  /** Filas placeholder para skeleton de tabla. */
  readonly tableSkeletonRows = Array.from({ length: 8 }, (_, i) => i);

  showTransactionModal = signal(false);
  showItemPicker = signal(false);
  transactionItemPreview = signal<{ partNumber: string; name: string } | null>(
    null,
  );
  transactionDialog =
    viewChild<ElementRef<HTMLDialogElement>>('transactionDialog');
  adjustDialog =
    viewChild<ElementRef<HTMLDialogElement>>('adjustDialog');
  transactionForm: FormGroup;
  adjustmentForm: FormGroup;

  showAdjustModal = signal(false);
  adjustStockRow = signal<any | null>(null);
  /** Edición rápida de ubicación en fila (id de item_stock). */
  editingLocationStockId = signal<string | null>(null);
  locationDraft = signal('');
  showAdjustmentConfirmModal = signal(false);
  adjustmentConfirmSummary = signal('');
  adjustmentRiskLevel = signal<'info' | 'warning' | 'danger'>('warning');

  constructor() {
    this.transactionForm = this.fb.group({
      type: ['IN', Validators.required],
      itemId: ['', Validators.required],
      quantity: [1, [Validators.required, Validators.min(0.01)]],
      unitCost: [0], // Solo para ingresos
      notes: [''],
    });

    this.adjustmentForm = this.fb.group({
      newPhysical: [0, [Validators.required, Validators.min(0)]],
      minStock: [0, [Validators.required, Validators.min(0)]],
      maxStock: [0, [Validators.required, Validators.min(0)]],
      location: [''],
      reason: ['CONTEO', Validators.required],
      comment: ['', [Validators.required, Validators.minLength(2)]],
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
        this.loadInventoryValuation();
        this.refreshPendingCount();
      },
      { allowSignalWrites: true },
    );
  }

  ngOnInit() {
    this.itemsService.getCategoryFamilies().subscribe({
      next: (rows) => this.families.set(rows),
      error: () => {},
    });
    this.stockService.getPendingCount().subscribe({
      next: (count) => this.pendingRegularizationCount.set(count),
      error: () => this.pendingRegularizationCount.set(0),
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
    this.adjustmentForm.reset({
      newPhysical: row.quantity,
      minStock: Number(row.minStock ?? 0),
      maxStock: Number(row.maxStock ?? 0),
      location: row.location ?? '',
      reason: 'CONTEO',
      comment: '',
    });
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
    const minChanged = Number(v.minStock) !== Number(row.minStock ?? 0);
    const maxChanged = Number(v.maxStock) !== Number(row.maxStock ?? 0);
    const stockChanged = Math.abs(diff) >= 1e-9;
    const locChanged =
      String(v.location ?? '').trim() !==
      String(row.location ?? '').trim();

    if (Number(v.maxStock) > 0 && Number(v.maxStock) < Number(v.minStock)) {
      this.notificationService.error(
        'El stock máximo no puede ser menor que el stock mínimo.',
      );
      return;
    }

    if (!stockChanged && !minChanged && !maxChanged && !locChanged) {
      this.notificationService.info(
        'No hay cambios por aplicar en stock, umbrales ni ubicación.',
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
    if (minChanged || maxChanged) {
      pieces.push(
        `umbrales: mínimo ${Number(v.minStock)} / máximo ${Number(v.maxStock)}`,
      );
    }
    if (locChanged) {
      pieces.push(`ubicación: "${String(v.location ?? '').trim() || '—'}"`);
    }
    this.adjustmentConfirmSummary.set(
      `Se aplicarán cambios: ${pieces.join(' | ')}. ¿Proceder?`,
    );
    this.adjustmentRiskLevel.set(stockChanged && diff < 0 ? 'danger' : 'warning');
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
    const minChanged = Number(v.minStock) !== Number(row.minStock ?? 0);
    const maxChanged = Number(v.maxStock) !== Number(row.maxStock ?? 0);
    const stockChanged = Math.abs(diff) >= 1e-9;
    const locChanged =
      String(v.location ?? '').trim() !==
      String(row.location ?? '').trim();

    if (Number(v.maxStock) > 0 && Number(v.maxStock) < Number(v.minStock)) {
      this.notificationService.error(
        'El stock máximo no puede ser menor que el stock mínimo.',
      );
      return;
    }

    const requests: Observable<unknown>[] = [];
    if (minChanged || maxChanged || locChanged) {
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
      requests.push(
        this.stockService.updateStockLevels(wh, row.item.id, payload),
      );
    }

    if (stockChanged) {
      requests.push(
        this.stockService.createPhysicalAdjustment({
          warehouseId: wh,
          itemId: row.item.id,
          newPhysicalQuantity: Number(v.newPhysical),
          reason: v.reason as 'MERMAS' | 'CONTEO' | 'DANO',
          comment: String(v.comment).trim(),
        }),
      );
    }

    if (requests.length === 0) {
      this.notificationService.info('No hay cambios para guardar.');
      return;
    }

    const request$ =
      requests.length === 1 ? requests[0] : forkJoin(requests);
    request$.subscribe({
      next: () => {
        this.notificationService.success('Cambios de stock guardados correctamente.');
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

  isStockRowCritical(s: {
    quantity: number;
    minStock: number;
  }): boolean {
    return s.minStock > 0 && s.quantity <= s.minStock && s.quantity === 0;
  }

  isStockRowLow(s: { quantity: number; minStock: number }): boolean {
    return (
      s.minStock > 0 &&
      s.quantity <= s.minStock &&
      s.quantity > 0
    );
  }

  stockRowClasses(s: { quantity: number; minStock: number }): string {
    const base =
      'hover:bg-dark/40 transition-colors border-l-4 border-solid ';
    if (this.isStockRowCritical(s)) {
      return `${base} bg-red-950/30 border-red-500`;
    }
    if (this.isStockRowLow(s)) {
      return `${base} bg-amber-950/25 border-amber-500`;
    }
    return `${base} border-transparent`;
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
    if (wId) {
      this.loadStock(wId);
    } else {
      this.stockItems.set([]);
      this.refreshPendingCount();
    }
  }

  loadStock(warehouseId: string) {
    this.stockLoading.set(true);
    this.stockService.getStockByWarehouse(warehouseId).subscribe({
      next: (data) => {
        this.stockItems.set(data);
        this.stockLoading.set(false);
        this.refreshPendingCount();
      },
      error: () => {
        this.notificationService.error('Error al cargar stock');
        this.stockLoading.set(false);
      },
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

  openTransactionModal() {
    if (!this.selectedWarehouseId()) {
      this.notificationService.info('Selecciona una bodega primero.');
      return;
    }
    this.transactionForm.reset({
      type: 'IN',
      quantity: 1,
      unitCost: 0,
      itemId: '',
      notes: '',
    });
    this.transactionItemPreview.set(null);
    this.showTransactionModal.set(true);
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
  }

  onTransactionItemPicked(row: ItemPickerRow) {
    this.transactionForm.patchValue({ itemId: row.id });
    this.transactionItemPreview.set({
      partNumber: row.partNumber,
      name: row.name,
    });
    this.showItemPicker.set(false);
  }

  onTransactionItemPickerClosed() {
    this.showItemPicker.set(false);
  }

  submitTransaction() {
    if (this.transactionForm.invalid) {
      this.transactionForm.markAllAsTouched();
      return;
    }

    const payload = {
      ...this.transactionForm.value,
      warehouseId: this.selectedWarehouseId(),
    };

    this.stockService.performTransaction(payload).subscribe({
      next: () => {
        this.notificationService.success('Movimiento registrado exitosamente.');
        this.closeTransactionModal();
        this.loadStock(this.selectedWarehouseId()); // Recargar tabla + pending count
      },
      error: (err) =>
        this.notificationService.error(
          err.error?.message || 'Error en la transacción.',
        ),
    });
  }
}
