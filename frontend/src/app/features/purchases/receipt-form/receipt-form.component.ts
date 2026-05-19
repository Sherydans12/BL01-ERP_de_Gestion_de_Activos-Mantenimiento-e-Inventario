import { Component, signal, computed, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { switchMap } from 'rxjs';
import {
  PurchasesService,
  WarehouseReceipt,
  ReceiptItem,
  ActivityLogEntry,
} from '../../../core/services/purchases/purchases.service';
import { NotificationService } from '../../../core/services/notification/notification.service';
import { ConfirmModalComponent } from '../../../shared/components/confirm-modal/confirm-modal.component';
import { PurchasesPushNoticeComponent } from '../../../shared/components/purchases-push-notice/purchases-push-notice.component';

interface EditableReceiptItem extends ReceiptItem {
  _quantityReceived: number;
  _observations: string;
}

@Component({
  selector: 'app-receipt-form',
  standalone: true,
  imports: [CommonModule, FormsModule, ConfirmModalComponent, PurchasesPushNoticeComponent],
  templateUrl: './receipt-form.component.html',
})
export class ReceiptFormComponent implements OnInit {
  private purchasesService = inject(PurchasesService);
  private notify = inject(NotificationService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  receipt = signal<WarehouseReceipt | null>(null);
  editableItems = signal<EditableReceiptItem[]>([]);
  isLoading = signal(true);
  isSaving = signal(false);
  showConfirmReceiptModal = signal(false);

  /** Historial de eventos de la guía (creación, guardados, confirmación). */
  logs = signal<ActivityLogEntry[]>([]);
  isLoadingLogs = signal(false);

  /**
   * Solo COMPLETED es de solo lectura, o si la OC padre está CLOSED
   * (cierre administrativo que congela todas las guías asociadas).
   */
  isReadonly = computed(() => {
    const r = this.receipt();
    if (!r) return true;
    if (r.status === 'COMPLETED') return true;
    if ((r.purchaseOrder as any)?.status === 'CLOSED') return true;
    return false;
  });

  isPartialWithHistory = computed(() => this.receipt()?.status === 'PARTIAL' && !this.isReadonly());

  /** Cantidad de ítems con alguna cantidad ingresada en el borrador actual. */
  itemsWithQtyCount = computed(() =>
    this.editableItems().filter(i => Number(i._quantityReceived) > 0).length,
  );

  totalItemsCount = computed(() => this.editableItems().length);

  totalReceivedDraft = computed(() =>
    this.editableItems().reduce((s, i) => s + Number(i._quantityReceived), 0),
  );

  /**
   * Verdadero cuando TODAS las líneas cubren el pedido completo de la OC.
   * Para PARTIAL: confirmed + additional >= expected.
   * Para PENDING: additional (= total) >= expected.
   */
  isFullReceipt = computed(() => {
    const items = this.editableItems();
    if (!items.length) return false;
    if (this.totalReceivedDraft() <= 0) return false;
    const partial = this.isPartialWithHistory();
    return items.every((i) => {
      const total = (partial ? Number(i.quantityConfirmed ?? 0) : 0) + Number(i._quantityReceived);
      return total >= Number(i.quantityExpected ?? 0) - 1e-9;
    });
  });

  confirmModalTitle = computed(() =>
    this.isFullReceipt()
      ? 'Confirmar recepción completa'
      : 'Confirmar recepción con cantidades parciales',
  );

  confirmModalMessage = computed(() =>
    this.isFullReceipt()
      ? 'Se moverá stock para todos los artículos ingresados. El inventario se actualizará y la OC quedará como completamente recibida. Esta acción es irreversible.'
      : 'Solo se moverá stock por las cantidades ingresadas en esta sesión. Los artículos sin cantidad adicional no generarán movimiento. Podrá continuar agregando el faltante desde esta misma vista.',
  );

  confirmModalConfirmText = computed(() =>
    this.isFullReceipt() ? 'Sí, confirmar recepción' : 'Confirmar recepción parcial',
  );

  hasUnlinkedItems = computed(() =>
    this.editableItems().some(i => !i.orderItem?.inventoryItem),
  );

  hasDirectExpenseItems = computed(() =>
    this.editableItems().some(
      i => i.orderItem?.inventoryItem && !i.orderItem.inventoryItem.isInventory,
    ),
  );

  isItemUnlinked(item: EditableReceiptItem): boolean {
    return !item.orderItem?.inventoryItem;
  }

  isItemDirectExpense(item: EditableReceiptItem): boolean {
    const inv = item.orderItem?.inventoryItem;
    return !!inv && inv.isInventory === false;
  }

  isItemStockTracked(item: EditableReceiptItem): boolean {
    const inv = item.orderItem?.inventoryItem;
    return !!inv && inv.isInventory !== false;
  }

  orderedQty(item: EditableReceiptItem): number {
    return Number(item.orderItem?.quantity ?? 0);
  }

  /**
   * Cantidad ya recibida en otras recepciones de la misma OC para este ítem.
   * orderedQty − quantityPendingOnPurchase (backend lo calcula excluyendo esta guía).
   */
  previouslyReceivedQty(item: EditableReceiptItem): number {
    const ordered = this.orderedQty(item);
    const pending = item.quantityPendingOnPurchase;
    if (typeof pending !== 'number' || Number.isNaN(pending)) return 0;
    return Math.max(0, ordered - pending);
  }

  /**
   * Techo del input según modo:
   *  - COMPLETED (readonly): snapshot quantityExpected del documento.
   *  - PARTIAL: pendiente = quantityExpected − quantityConfirmed (lo que falta por recibir).
   *  - PENDING: cap del backend = pedido OC − suma en otras recepciones (quantityPendingOnPurchase).
   */
  capQty(item: EditableReceiptItem): number {
    if (this.isReadonly()) {
      return Number(item.quantityExpected ?? 0);
    }
    if (this.isPartialWithHistory()) {
      const pending = Number(item.quantityExpected ?? 0) - Number(item.quantityConfirmed ?? 0);
      return Math.max(0, pending);
    }
    const p = item.quantityPendingOnPurchase;
    if (typeof p === 'number' && !Number.isNaN(p)) {
      return p;
    }
    return Number(item.quantityExpected ?? 0);
  }

  /** En modo PARTIAL _quantityReceived ya es la cantidad adicional → mínimo 0. */
  minQty(_item: EditableReceiptItem): number {
    return 0;
  }

  /** Delta que se moverá a stock: en PARTIAL es _quantityReceived directamente; en PENDING ídem. */
  deltaQty(item: EditableReceiptItem): number {
    return Math.max(0, Number(item._quantityReceived));
  }

  /** Clases de fondo para la fila según estado de cantidad. Sin `/` para evitar error de Angular. */
  rowHighlightClass(item: EditableReceiptItem): string {
    if (this.isReadonly()) return '';
    const qty = Number(item._quantityReceived);
    const cap = this.capQty(item);
    if (qty > 0 && cap > 0 && qty >= cap) return 'row-qty-complete';
    if (qty > 0) return 'row-qty-partial';
    return '';
  }

  /** Resaltar fila si la cantidad no iguala el tope esperado (borrador). */
  qtyRowHighlight(item: EditableReceiptItem): boolean {
    if (this.isReadonly()) return false;
    return Math.abs(Number(item._quantityReceived) - this.capQty(item)) > 1e-9;
  }

  // ── Etiquetas de eventos de historial ──────────────────────────────────────

  logEventLabel(log: ActivityLogEntry): string {
    const ev = (log.details?.newValue as any)?.event;
    switch (ev) {
      case 'warehouse_receipt_created':   return 'Guía abierta';
      case 'receipt_progress_saved':      return 'Avance guardado';
      case 'warehouse_receipt_partial':   return 'Confirmación parcial';
      case 'warehouse_receipt_completed': return 'Recepción completada';
      default:                            return 'Actualización';
    }
  }

  logEventColor(log: ActivityLogEntry): string {
    const ev = (log.details?.newValue as any)?.event;
    switch (ev) {
      case 'warehouse_receipt_created':   return 'text-primary bg-primary/10 border-primary/25';
      case 'receipt_progress_saved':      return 'text-muted bg-dark border-border';
      case 'warehouse_receipt_partial':   return 'text-amber-400 bg-amber-500/10 border-amber-500/25';
      case 'warehouse_receipt_completed': return 'text-green-400 bg-green-500/10 border-green-500/25';
      default:                            return 'text-muted bg-dark border-border';
    }
  }

  logSummary(log: ActivityLogEntry): string {
    const nv = log.details?.newValue as any;
    if (!nv) return '';
    if (nv.event === 'receipt_progress_saved') {
      const art = nv.itemsWithQty === 1 ? 'artículo' : 'artículos';
      return `${nv.itemsWithQty ?? 0} de ${nv.totalItems ?? '?'} ${art} con cantidad — total ingresado: ${nv.totalQuantity ?? 0}`;
    }
    if (nv.event === 'warehouse_receipt_partial' || nv.event === 'warehouse_receipt_completed') {
      const parts: string[] = [];
      if (nv.stockTrackedArticles != null) {
        const art = nv.stockTrackedArticles === 1 ? 'artículo' : 'artículos';
        const qty = nv.totalQuantityMoved != null ? ` (${nv.totalQuantityMoved} unid.)` : '';
        parts.push(`${nv.stockTrackedArticles} ${art} a stock${qty}`);
      }
      if (nv.directExpenseItems > 0) {
        parts.push(`${nv.directExpenseItems} gasto directo`);
      }
      if (nv.skippedItems > 0) {
        parts.push(`${nv.skippedItems} sin catálogo`);
      }
      return parts.join(' · ') || '';
    }
    return '';
  }

  // ── Ciclo de vida ──────────────────────────────────────────────────────────

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.load(id);
      this.loadLogs(id);
    }
  }

  load(id: string) {
    this.isLoading.set(true);
    this.purchasesService.getReceipt(id).subscribe({
      next: (data) => {
        this.receipt.set(data);
        const isPartial = data.status === 'PARTIAL';
        this.editableItems.set(
          (data.items ?? []).map((item) => ({
            ...item,
            /**
             * PARTIAL: el campo muestra la cantidad ADICIONAL a recibir en esta sesión
             * (empieza en 0; el máximo es el pendiente = quantityExpected − quantityConfirmed).
             * PENDING: muestra el total acumulado en el borrador.
             */
            _quantityReceived: isPartial ? 0 : item.quantityReceived,
            _observations: item.observations || '',
          })),
        );
        this.isLoading.set(false);
      },
      error: (err: unknown) => {
        const msg =
          err && typeof err === 'object' && 'error' in err
            ? (err as { error?: { message?: string } }).error?.message
            : undefined;
        this.notify.error(typeof msg === 'string' ? msg : 'Error al cargar recepción');
        this.isLoading.set(false);
      },
    });
  }

  loadLogs(id: string) {
    this.isLoadingLogs.set(true);
    this.purchasesService.getReceiptLogs(id).subscribe({
      next: (data) => {
        this.logs.set(data);
        this.isLoadingLogs.set(false);
      },
      error: () => this.isLoadingLogs.set(false),
    });
  }

  // ── Modal detalle de artículo ──────────────────────────────────────────────

  selectedItem = signal<EditableReceiptItem | null>(null);

  openItemModal(item: EditableReceiptItem) { this.selectedItem.set(item); }
  closeItemModal()                          { this.selectedItem.set(null); }

  // ── Indicador visual de estado de cantidad por ítem ───────────────────────

  /**
   * Devuelve un objeto con label y clases CSS para mostrar el estado de la
   * cantidad ingresada junto al input de cada artículo.
   */
  qtyStatus(item: EditableReceiptItem): { label: string; classes: string } {
    const cap = this.capQty(item);
    const qty = Number(item._quantityReceived);

    if (cap <= 0) {
      return { label: '✓ Completo', classes: 'text-green-400 bg-green-500/10 border-green-500/25' };
    }
    if (qty <= 0) {
      return { label: 'sin ingresar', classes: 'text-muted bg-dark border-border' };
    }
    if (Math.abs(qty - cap) <= 1e-9) {
      const total = (this.isPartialWithHistory() ? Number(item.quantityConfirmed ?? 0) : 0) + qty;
      return { label: `✓ ${total} / ${Number(item.quantityExpected)}`, classes: 'text-green-400 bg-green-500/10 border-green-500/25' };
    }
    const confirmed = this.isPartialWithHistory() ? Number(item.quantityConfirmed ?? 0) : 0;
    const total = confirmed + qty;
    return {
      label: `parcial: ${total} de ${Number(item.quantityExpected)}`,
      classes: 'text-amber-400 bg-amber-500/10 border-amber-500/25',
    };
  }

  // ── Edición de ítems ───────────────────────────────────────────────────────

  updateItemQty(index: number, value: number) {
    const items = this.editableItems();
    const item = items[index];
    if (!item) return;
    const cap = this.capQty(item);
    let v = Number(value);
    if (Number.isNaN(v)) v = 0;
    v = Math.max(0, Math.min(v, cap));
    this.editableItems.update((list) =>
      list.map((it, i) => (i === index ? { ...it, _quantityReceived: v } : it)),
    );
  }

  updateItemObs(index: number, value: string) {
    this.editableItems.update(items =>
      items.map((item, i) => i === index ? { ...item, _observations: value } : item),
    );
  }

  // ── Payload hacia la API ───────────────────────────────────────────────────

  private buildItemsPayload() {
    const partial = this.isPartialWithHistory();
    return this.editableItems().map(i => ({
      id: i.id,
      quantityReceived: partial
        ? Number(i.quantityConfirmed ?? 0) + Number(i._quantityReceived)
        : Number(i._quantityReceived),
      observations: i._observations || undefined,
    }));
  }

  // ── Flujo de confirmación (guarda cantidades y mueve stock) ────────────────

  requestConfirmReceipt() {
    const receipt = this.receipt();
    if (!receipt) return;
    if (this.totalReceivedDraft() <= 0) {
      this.notify.warning('Ingrese al menos una cantidad antes de confirmar');
      return;
    }
    this.showConfirmReceiptModal.set(true);
  }

  cancelConfirmReceipt() {
    this.showConfirmReceiptModal.set(false);
  }

  /** Guarda las cantidades actuales y confirma la recepción: mueve stock. */
  confirmReceiptFinal() {
    this.showConfirmReceiptModal.set(false);
    const receipt = this.receipt();
    if (!receipt) return;

    const items = this.buildItemsPayload();

    this.isSaving.set(true);
    this.purchasesService
      .updateReceiptItems(receipt.id, items)
      .pipe(switchMap(() => this.purchasesService.confirmReceipt(receipt.id)))
      .subscribe({
        next: (result: any) => {
          const summary = result?.stockSummary;
          if (summary?.skippedItems > 0) {
            const art = summary.trackedItems === 1 ? 'artículo actualizó' : 'artículos actualizaron';
            this.notify.success(`Recepción confirmada. ${summary.trackedItems} ${art} el stock.`);
            if (summary.skippedNoLink > 0) {
              const a2 = summary.skippedNoLink === 1 ? 'artículo sin' : 'artículos sin';
              this.notify.warning(`${summary.skippedNoLink} ${a2} vínculo al catálogo (no mueven stock).`);
            }
            if (summary.directExpenseItems > 0) {
              const a3 = summary.directExpenseItems === 1 ? 'artículo registrado' : 'artículos registrados';
              this.notify.info(`${summary.directExpenseItems} ${a3} como Gasto Directo.`);
            }
          } else {
            this.notify.success('Recepción confirmada. Inventario actualizado.');
          }
          this.load(receipt.id);
          this.loadLogs(receipt.id);
          this.isSaving.set(false);
        },
        error: (err: unknown) => {
          const msg =
            err && typeof err === 'object' && 'error' in err
              ? (err as { error?: { message?: string } }).error?.message
              : undefined;
          this.notify.error(typeof msg === 'string' ? msg : 'Error al confirmar recepción');
          this.isSaving.set(false);
        },
      });
  }
}
