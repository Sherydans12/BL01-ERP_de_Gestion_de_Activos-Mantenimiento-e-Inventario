import { Component, Input, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import {
  InventoryItemsService,
  ItemLedgerRow,
} from '../../../core/services/inventory-items/inventory-items.service';
import { EntityLinkComponent } from '../entity-link/entity-link.component';
import { WorkOrderDetailModalComponent } from '../../../features/work-orders/work-order-detail-modal/work-order-detail-modal.component';
import { parseInventoryAdjustmentNotes } from '../../../core/utils/inventory-adjustment-notes';

/**
 * Tabla Kardex reutilizable para el historial de movimientos de un artículo.
 *
 * Muestra transacciones físicas (`InventoryTransaction`) más la fila sintética
 * de génesis (`ITEM_GENESIS`) que proviene del `ActivityLog` `CREATE` del backend.
 * Ambos se reciben en el mismo endpoint `GET /inventory-items/:id/ledger`.
 *
 * Uso:
 * ```html
 * <app-item-ledger-table
 *   [itemId]="item.id"
 *   [warehouseId]="warehouseId"
 *   [warehouseLabel]="warehouseLabel"
 * />
 * ```
 */
@Component({
  selector: 'app-item-ledger-table',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    EntityLinkComponent,
    WorkOrderDetailModalComponent,
  ],
  templateUrl: './item-ledger-table.component.html',
})
export class ItemLedgerTableComponent implements OnInit {
  private inventoryItemsService = inject(InventoryItemsService);

  /** ID del artículo cuyo historial se muestra. Requerido. */
  @Input({ required: true }) itemId!: string;

  /**
   * Si se informa, el historial solo incluye movimientos de esa bodega.
   * La fila ITEM_GENESIS siempre aparece independientemente del filtro.
   */
  @Input() warehouseId?: string | null;

  /** Etiqueta legible de la bodega para el subtítulo cuando está filtrado. */
  @Input() warehouseLabel?: string | null;

  readonly ledgerPageSize = 25;

  rows = signal<ItemLedgerRow[]>([]);
  total = signal(0);
  page = signal(1);
  loading = signal(false);
  error = signal<string | null>(null);

  adjustDetailOpen = signal(false);
  adjustDetailRow = signal<ItemLedgerRow | null>(null);

  otModalOpen = signal(false);
  otModalId = signal<string | null>(null);

  ngOnInit() {
    this.loadPage(1);
  }

  warehouseScoped(): boolean {
    return !!this.warehouseId?.trim();
  }

  loadPage(p: number) {
    this.loading.set(true);
    this.error.set(null);
    const wid = this.warehouseId?.trim() || undefined;
    this.inventoryItemsService
      .getItemLedger(this.itemId, { page: p, pageSize: this.ledgerPageSize, warehouseId: wid })
      .subscribe({
        next: (res) => {
          this.rows.set(res.data);
          this.total.set(res.total);
          this.page.set(res.page);
          this.loading.set(false);
        },
        error: (err) => {
          this.error.set(err.error?.message ?? 'No se pudo cargar el historial.');
          this.rows.set([]);
          this.total.set(0);
          this.loading.set(false);
        },
      });
  }

  totalPages(): number {
    return Math.max(1, Math.ceil(this.total() / this.ledgerPageSize));
  }

  prevPage() {
    if (this.page() > 1) this.loadPage(this.page() - 1);
  }

  nextPage() {
    if (this.page() < this.totalPages()) this.loadPage(this.page() + 1);
  }

  // ── Mapeo visual ────────────────────────────────────────────────────────────

  /** Etiqueta legible por tipo de movimiento. */
  typeLabel(type: string): string {
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
      ITEM_GENESIS: 'Alta en catálogo',
    };
    return map[type] ?? type;
  }

  /** Título enriquecido (detecta variante de ajuste de saldo pendiente). */
  movementTitle(row: ItemLedgerRow): string {
    if (row.type === 'ADJUST' && row.reference?.kind === 'ADJUST_SALDO_PENDIENTE') {
      return 'Ajuste · saldo pendiente (recepción)';
    }
    if (row.type === 'ADJUST' && row.reference?.kind === 'INVENTORY_ADJUSTMENT') {
      return this.parseAdjustmentNotes(row.notes).reason || 'Ajuste';
    }
    return this.typeLabel(row.type);
  }

  /**
   * Cantidad con signo para lectura de kardex.
   * Devuelve `null` para ITEM_GENESIS (se muestra `—` en el template).
   */
  signedQty(row: ItemLedgerRow): number | null {
    if (row.type === 'ITEM_GENESIS') return null;
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

  // ── Adjust detail overlay ───────────────────────────────────────────────────

  openAdjustDetail(row: ItemLedgerRow) {
    if (row.type !== 'ADJUST') return;
    this.adjustDetailRow.set(row);
    this.adjustDetailOpen.set(true);
  }

  closeAdjustDetail() {
    this.adjustDetailOpen.set(false);
    this.adjustDetailRow.set(null);
  }

  parseAdjustmentNotes(notes: string | null): { reason: string; comment: string } {
    return parseInventoryAdjustmentNotes(notes);
  }

  // ── OT quick view modal ─────────────────────────────────────────────────────

  openOtModal(workOrderId: string) {
    this.otModalId.set(workOrderId);
    this.otModalOpen.set(true);
  }

  closeOtModal() {
    this.otModalOpen.set(false);
    this.otModalId.set(null);
  }
}
