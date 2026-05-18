import {
  Component,
  EventEmitter,
  HostListener,
  Input,
  Output,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { InventoryItemsService } from '../../../core/services/inventory-items/inventory-items.service';
import { ItemLedgerTableComponent } from '../../../shared/components/item-ledger-table/item-ledger-table.component';

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
  imports: [
    CommonModule,
    RouterLink,
    ItemLedgerTableComponent,
  ],
  templateUrl: './catalog-item-detail-modal.component.html',
})
export class CatalogItemDetailModalComponent {
  private inventoryItemsService = inject(InventoryItemsService);

  @Input() open = false;
  @Input() loading = false;
  @Input() item: CatalogItemDetailRow | null = null;
  @Input() errorMessage: string | null = null;
  /** En vistas de solo lectura (p. ej. control de stock) ocultar enlace a edición. */
  @Input() showEditLink = true;
  /**
   * Si se informa, el historial solo incluye movimientos cuya transacción pertenece a esa bodega
   * (entradas/salidas/traslados registrados en esa ubicación).
   */
  @Input() ledgerWarehouseId: string | null | undefined;
  /** Etiqueta legible de la bodega (código — nombre) para el subtítulo del historial filtrado. */
  @Input() ledgerWarehouseLabel: string | null | undefined;

  @Output() closed = new EventEmitter<void>();

  activePanel = signal<'detail' | 'ledger'>('detail');

  @HostListener('document:keydown.escape')
  onEscape() {
    if (!this.open) return;
    this.close();
  }

  close() {
    this.activePanel.set('detail');
    this.closed.emit();
  }

  ledgerWarehouseScoped(): boolean {
    return !!this.ledgerWarehouseId?.trim();
  }

  setPanel(panel: 'detail' | 'ledger') {
    this.activePanel.set(panel);
  }

  dash(v: string | null | undefined): string {
    const s = String(v ?? '').trim();
    return s ? s : '—';
  }

  boolLabel(v: boolean | undefined): string {
    return v ? 'Sí' : 'No';
  }
}
