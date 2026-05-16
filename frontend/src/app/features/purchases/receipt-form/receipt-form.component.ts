import { Component, signal, computed, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { PurchasesService, WarehouseReceipt, ReceiptItem } from '../../../core/services/purchases/purchases.service';
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

  isReadonly = computed(() => this.receipt()?.status !== 'PENDING');

  hasDiscrepancies = computed(() =>
    this.editableItems().some((i) => {
      const cap = this.capQty(i);
      return Math.abs(Number(i._quantityReceived) - cap) > 1e-9;
    }),
  );

  hasUnlinkedItems = computed(() =>
    this.editableItems().some(i => !i.orderItem?.inventoryItem),
  );

  hasDirectExpenseItems = computed(() =>
    this.editableItems().some(
      i => i.orderItem?.inventoryItem && !(i.orderItem.inventoryItem as any).isInventory,
    ),
  );

  isItemUnlinked(item: EditableReceiptItem): boolean {
    return !item.orderItem?.inventoryItem;
  }

  isItemDirectExpense(item: EditableReceiptItem): boolean {
    const inv = item.orderItem?.inventoryItem as any;
    return inv && inv.isInventory === false;
  }

  isItemStockTracked(item: EditableReceiptItem): boolean {
    const inv = item.orderItem?.inventoryItem as any;
    return inv && inv.isInventory !== false;
  }

  orderedQty(item: EditableReceiptItem): number {
    return Number(item.orderItem?.quantity ?? 0);
  }

  /**
   * Techo de recepción alineado con backend: pedido OC − suma en otras recepciones.
   * En lectura (confirmada) se muestra el snapshot `quantityExpected` del documento.
   */
  capQty(item: EditableReceiptItem): number {
    if (this.isReadonly()) {
      return Number(item.quantityExpected ?? 0);
    }
    const p = item.quantityPendingOnPurchase;
    if (typeof p === 'number' && !Number.isNaN(p)) {
      return p;
    }
    return Number(item.quantityExpected ?? 0);
  }

  /** Resaltar fila si la cantidad no iguala el tope esperado (borrador). */
  qtyRowHighlight(item: EditableReceiptItem): boolean {
    if (this.isReadonly()) return false;
    return Math.abs(Number(item._quantityReceived) - this.capQty(item)) > 1e-9;
  }

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) this.load(id);
  }

  load(id: string) {
    this.isLoading.set(true);
    this.purchasesService.getReceipt(id).subscribe({
      next: (data) => {
        this.receipt.set(data);
        this.editableItems.set(
          data.items.map(item => ({
            ...item,
            _quantityReceived: item.quantityReceived,
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

  saveItems() {
    const receipt = this.receipt();
    if (!receipt) return;
    this.isSaving.set(true);

    const items = this.editableItems().map(i => ({
      id: i.id,
      quantityReceived: i._quantityReceived,
      observations: i._observations || undefined,
    }));

    this.purchasesService.updateReceiptItems(receipt.id, items).subscribe({
      next: () => {
        this.notify.success('Cantidades guardadas');
        this.load(receipt.id);
        this.isSaving.set(false);
      },
      error: (err: unknown) => {
        const msg =
          err && typeof err === 'object' && 'error' in err
            ? (err as { error?: { message?: string } }).error?.message
            : undefined;
        this.notify.error(typeof msg === 'string' ? msg : 'Error al guardar');
        this.isSaving.set(false);
      },
    });
  }

  requestConfirmReceipt() {
    const receipt = this.receipt();
    if (!receipt) return;
    const totalReceived = this.editableItems().reduce((s, i) => s + Number(i._quantityReceived), 0);
    if (totalReceived <= 0) {
      this.notify.warning('Indique cantidades recibidas antes de confirmar');
      return;
    }
    this.showConfirmReceiptModal.set(true);
  }

  cancelConfirmReceipt() {
    this.showConfirmReceiptModal.set(false);
  }

  /** Guarda líneas y confirma recepción: actualiza inventario de forma definitiva. */
  confirmReceiptFinal() {
    this.showConfirmReceiptModal.set(false);
    const receipt = this.receipt();
    if (!receipt) return;

    const items = this.editableItems().map((i) => ({
      id: i.id,
      quantityReceived: i._quantityReceived,
      observations: i._observations || undefined,
    }));

    this.isSaving.set(true);
    this.purchasesService.updateReceiptItems(receipt.id, items).subscribe({
      next: () => {
        this.purchasesService.confirmReceipt(receipt.id).subscribe({
          next: (result: any) => {
            const summary = result?.stockSummary;
            if (summary?.skippedItems > 0) {
              this.notify.success(
                `Recepción confirmada. ${summary.trackedItems} ítem(s) actualizaron el stock.`,
              );
              if (summary.skippedNoLink > 0) {
                this.notify.warning(
                  `${summary.skippedNoLink} ítem(s) sin vínculo al catálogo (no mueven stock).`,
                );
              }
              if (summary.directExpenseItems > 0) {
                this.notify.info(
                  `${summary.directExpenseItems} ítem(s) registrado(s) como Gasto Directo (sin movimiento de stock).`,
                );
              }
            } else {
              this.notify.success('Recepción confirmada. Inventario actualizado.');
            }
            this.load(receipt.id);
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
      },
      error: (err: unknown) => {
        const msg =
          err && typeof err === 'object' && 'error' in err
            ? (err as { error?: { message?: string } }).error?.message
            : undefined;
        this.notify.error(typeof msg === 'string' ? msg : 'Error al guardar cantidades');
        this.isSaving.set(false);
      },
    });
  }
}
