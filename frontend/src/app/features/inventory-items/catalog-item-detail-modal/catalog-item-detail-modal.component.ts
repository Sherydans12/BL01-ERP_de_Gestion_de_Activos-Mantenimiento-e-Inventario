import { Component, EventEmitter, HostListener, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

/** Fila devuelta por `GET /inventory-items/:id` (subset usado en la vista). */
export interface CatalogItemDetailRow {
  id: string;
  inventoryCode?: string | null;
  partNumber?: string | null;
  qrCode?: string | null;
  name: string;
  description?: string | null;
  brand?: string | null;
  compatibilityInfo?: string | null;
  isSerialized?: boolean;
  isInventory?: boolean;
  isAsset?: boolean;
  isConsumable?: boolean;
  unitOfMeasure?: { name: string; abbreviation: string } | null;
  itemCategory?: {
    name: string;
    parentCategory?: { name: string } | null;
  } | null;
  inventorySupplier?: { id: string; name: string } | null;
}

@Component({
  selector: 'app-catalog-item-detail-modal',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './catalog-item-detail-modal.component.html',
})
export class CatalogItemDetailModalComponent {
  @Input() open = false;
  @Input() loading = false;
  @Input() item: CatalogItemDetailRow | null = null;
  @Input() errorMessage: string | null = null;

  @Output() closed = new EventEmitter<void>();

  @HostListener('document:keydown.escape')
  onEscape() {
    if (this.open) {
      this.close();
    }
  }

  close() {
    this.closed.emit();
  }

  dash(v: string | null | undefined): string {
    const s = String(v ?? '').trim();
    return s ? s : '—';
  }

  boolLabel(v: boolean | undefined): string {
    return v ? 'Sí' : 'No';
  }
}
