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
import {
  InventoryItemsService,
  ItemLedgerRow,
} from '../../../core/services/inventory-items/inventory-items.service';
import { EntityLinkComponent } from '../../../shared/components/entity-link/entity-link.component';
import { WorkOrderDetailModalComponent } from '../../work-orders/work-order-detail-modal/work-order-detail-modal.component';

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
    EntityLinkComponent,
    WorkOrderDetailModalComponent,
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
  ledgerRows = signal<ItemLedgerRow[]>([]);
  ledgerTotal = signal(0);
  ledgerPage = signal(1);
  readonly ledgerPageSize = 25;
  ledgerLoading = signal(false);
  ledgerError = signal<string | null>(null);

  adjustDetailOpen = signal(false);
  adjustDetailRow = signal<ItemLedgerRow | null>(null);
  ledgerOtModalOpen = signal(false);
  ledgerOtModalId = signal<string | null>(null);

  @HostListener('document:keydown.escape')
  onEscape() {
    if (!this.open) return;
    if (this.adjustDetailOpen()) {
      this.closeAdjustDetail();
      return;
    }
    if (this.ledgerOtModalOpen()) {
      this.closeLedgerOtModal();
      return;
    }
    this.close();
  }

  close() {
    this.resetLedgerUi();
    this.closed.emit();
  }

  ledgerWarehouseScoped(): boolean {
    return !!this.ledgerWarehouseId?.trim();
  }

  setPanel(panel: 'detail' | 'ledger') {
    this.activePanel.set(panel);
    if (panel === 'ledger' && this.item?.id) {
      this.loadLedger(1);
    }
  }

  loadLedger(page: number) {
    const id = this.item?.id;
    if (!id) return;
    this.ledgerLoading.set(true);
    this.ledgerError.set(null);
    const wid = this.ledgerWarehouseId?.trim();
    this.inventoryItemsService
      .getItemLedger(id, {
        page,
        pageSize: this.ledgerPageSize,
        warehouseId: wid || undefined,
      })
      .subscribe({
        next: (res) => {
          this.ledgerRows.set(res.data);
          this.ledgerTotal.set(res.total);
          this.ledgerPage.set(res.page);
          this.ledgerLoading.set(false);
        },
        error: (err) => {
          const msg =
            err.error?.message || 'No se pudo cargar el historial de movimientos.';
          this.ledgerError.set(msg);
          this.ledgerRows.set([]);
          this.ledgerTotal.set(0);
          this.ledgerLoading.set(false);
        },
      });
  }

  ledgerTotalPages(): number {
    const t = this.ledgerTotal();
    if (t <= 0) return 1;
    return Math.max(1, Math.ceil(t / this.ledgerPageSize));
  }

  prevLedgerPage() {
    if (this.ledgerPage() <= 1) return;
    this.loadLedger(this.ledgerPage() - 1);
  }

  nextLedgerPage() {
    if (this.ledgerPage() >= this.ledgerTotalPages()) return;
    this.loadLedger(this.ledgerPage() + 1);
  }

  ledgerTypeLabel(type: string): string {
    const map: Record<string, string> = {
      IN: 'Entrada',
      OUT: 'Salida',
      ADJUST: 'Ajuste',
      RETURN: 'Devolución',
      PURCHASE_RECEIPT: 'Recepción compra',
      WORK_ORDER_ISSUE: 'Consumo OT',
      WORK_ORDER_RETURN: 'Devolución a bodega (OT)',
      TRANSFER_OUT: 'Transferencia (salida)',
      TRANSFER_IN: 'Transferencia (ingreso)',
    };
    return map[type] ?? type;
  }

  ledgerSignedQty(row: ItemLedgerRow): number {
    const q = Number(row.quantity);
    switch (row.type) {
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

  openAdjustDetail(row: ItemLedgerRow) {
    if (row.type !== 'ADJUST') return;
    this.adjustDetailRow.set(row);
    this.adjustDetailOpen.set(true);
  }

  closeAdjustDetail() {
    this.adjustDetailOpen.set(false);
    this.adjustDetailRow.set(null);
  }

  openLedgerOtModal(workOrderId: string) {
    this.ledgerOtModalId.set(workOrderId);
    this.ledgerOtModalOpen.set(true);
  }

  closeLedgerOtModal() {
    this.ledgerOtModalOpen.set(false);
    this.ledgerOtModalId.set(null);
  }

  parseAdjustmentNotes(notes: string | null): { reason: string; comment: string } {
    if (!notes?.trim()) {
      return { reason: '', comment: '' };
    }
    const m = notes.match(/^Ajuste\s*\[([^\]]+)\]\s*:\s*([\s\S]*)$/);
    if (m) {
      return { reason: m[1].trim(), comment: m[2].trim() };
    }
    return { reason: 'Ajuste', comment: notes.trim() };
  }

  dash(v: string | null | undefined): string {
    const s = String(v ?? '').trim();
    return s ? s : '—';
  }

  boolLabel(v: boolean | undefined): string {
    return v ? 'Sí' : 'No';
  }

  private resetLedgerUi() {
    this.activePanel.set('detail');
    this.ledgerRows.set([]);
    this.ledgerTotal.set(0);
    this.ledgerPage.set(1);
    this.ledgerLoading.set(false);
    this.ledgerError.set(null);
    this.adjustDetailOpen.set(false);
    this.adjustDetailRow.set(null);
    this.ledgerOtModalOpen.set(false);
    this.ledgerOtModalId.set(null);
  }
}
