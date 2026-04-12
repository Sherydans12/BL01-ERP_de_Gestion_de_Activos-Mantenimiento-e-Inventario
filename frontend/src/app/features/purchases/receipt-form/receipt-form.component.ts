import { Component, signal, computed, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { PurchasesService, WarehouseReceipt, ReceiptItem } from '../../../core/services/purchases/purchases.service';
import { NotificationService } from '../../../core/services/notification/notification.service';

interface EditableReceiptItem extends ReceiptItem {
  _quantityReceived: number;
  _observations: string;
}

@Component({
  selector: 'app-receipt-form',
  standalone: true,
  imports: [CommonModule, FormsModule],
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

  isReadonly = computed(() => this.receipt()?.status === 'COMPLETED');

  hasDiscrepancies = computed(() =>
    this.editableItems().some(i => i._quantityReceived !== i.quantityExpected)
  );

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
      error: () => { this.notify.error('Error al cargar recepción'); this.isLoading.set(false); },
    });
  }

  updateItemQty(index: number, value: number) {
    this.editableItems.update(items =>
      items.map((item, i) => i === index ? { ...item, _quantityReceived: value } : item),
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
      next: () => { this.notify.success('Cantidades guardadas'); this.isSaving.set(false); },
      error: () => { this.notify.error('Error al guardar'); this.isSaving.set(false); },
    });
  }

  confirm() {
    const receipt = this.receipt();
    if (!receipt) return;

    this.saveItems();
    setTimeout(() => {
      this.purchasesService.confirmReceipt(receipt.id).subscribe({
        next: () => { this.notify.success('Recepción confirmada. Inventario actualizado.'); this.load(receipt.id); },
        error: (err: any) => this.notify.error(err?.error?.message || 'Error al confirmar'),
      });
    }, 500);
  }
}
