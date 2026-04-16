import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthService } from '../../core/services/auth/auth.service';
import { InventoryTransferRow, InventoryTransferService } from '../../core/services/inventory-transfer/inventory-transfer.service';
import { NotificationService } from '../../core/services/notification/notification.service';
import { WarehousesService } from '../../core/services/warehouses/warehouses.service';
import { ItemPickerRow } from '../../core/services/inventory-items/inventory-items.service';
import { ConfirmModalComponent } from '../../shared/components/confirm-modal/confirm-modal.component';
import { GlobalItemPickerComponent } from '../../shared/components/global-item-picker/global-item-picker.component';

type DraftLine = {
  itemId: string;
  partNumber: string;
  name: string;
  unitOfMeasure: string;
  quantity: number;
};

type PendingAction =
  | { type: 'send' }
  | { type: 'receive'; transfer: InventoryTransferRow };

@Component({
  selector: 'app-inventory-transfer',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    ConfirmModalComponent,
    GlobalItemPickerComponent,
  ],
  templateUrl: './inventory-transfer.component.html',
})
export class InventoryTransferComponent implements OnInit {
  private fb = inject(FormBuilder);
  private authService = inject(AuthService);
  private transferService = inject(InventoryTransferService);
  private warehousesService = inject(WarehousesService);
  private notificationService = inject(NotificationService);
  private route = inject(ActivatedRoute);

  readonly transferWarningMessage =
    'Advertencia de impacto financiero: esta acción afectará la valorización del inventario entre bodegas y quedará registrada para auditoría.';

  warehouses = signal<any[]>([]);
  warehousesLoading = signal(true);
  transfers = signal<InventoryTransferRow[]>([]);
  transfersLoading = signal(true);
  lines = signal<DraftLine[]>([]);
  pickerOpen = signal(false);

  confirmOpen = signal(false);
  confirmTitle = signal('Confirmar acción');
  confirmText = signal('Confirmar');
  confirmSummary = signal('');
  pendingAction = signal<PendingAction | null>(null);

  transferForm = this.fb.group({
    originWarehouseId: ['', Validators.required],
    destinationWarehouseId: ['', Validators.required],
  });

  canSubmit = computed(() => {
    const v = this.transferForm.getRawValue();
    return (
      this.transferForm.valid &&
      !!v.originWarehouseId &&
      !!v.destinationWarehouseId &&
      v.originWarehouseId !== v.destinationWarehouseId &&
      this.lines().length > 0 &&
      this.lines().every((l) => l.quantity > 0)
    );
  });

  constructor() {
    effect(
      () => {
        this.authService.currentContractId();
        this.loadWarehouses();
        this.loadTransfers();
      },
      { allowSignalWrites: true },
    );
  }

  ngOnInit(): void {}

  loadWarehouses() {
    this.warehousesLoading.set(true);
    this.warehousesService.getWarehouses().subscribe({
      next: (rows) => {
        this.warehouses.set(rows);
        this.warehousesLoading.set(false);
        const origen = this.route.snapshot.queryParamMap.get('origen');
        if (origen && rows.some((w) => w.id === origen)) {
          this.transferForm.patchValue({ originWarehouseId: origen });
        }
      },
      error: () => {
        this.warehouses.set([]);
        this.warehousesLoading.set(false);
        this.notificationService.error('No se pudieron cargar las bodegas.');
      },
    });
  }

  loadTransfers() {
    this.transfersLoading.set(true);
    this.transferService.listTransfers().subscribe({
      next: (rows) => {
        this.transfers.set(rows ?? []);
        this.transfersLoading.set(false);
      },
      error: () => {
        this.transfers.set([]);
        this.transfersLoading.set(false);
      },
    });
  }

  openPicker() {
    const originWarehouseId = this.transferForm.get('originWarehouseId')?.value;
    if (!originWarehouseId) {
      this.notificationService.info('Seleccione una bodega origen antes de agregar ítems.');
      return;
    }
    this.pickerOpen.set(true);
  }

  onPickerClosed() {
    this.pickerOpen.set(false);
  }

  onItemPicked(row: ItemPickerRow) {
    this.pickerOpen.set(false);
    this.lines.update((curr) => {
      const idx = curr.findIndex((line) => line.itemId === row.id);
      if (idx >= 0) {
        const updated = [...curr];
        updated[idx] = { ...updated[idx], quantity: updated[idx].quantity + 1 };
        return updated;
      }
      return [
        ...curr,
        {
          itemId: row.id,
          partNumber: row.partNumber,
          name: row.name,
          unitOfMeasure: row.unitOfMeasure?.abbreviation ?? 'u',
          quantity: 1,
        },
      ];
    });
  }

  setLineQty(itemId: string, value: string) {
    const qty = Number(value);
    this.lines.update((curr) =>
      curr.map((line) =>
        line.itemId === itemId
          ? { ...line, quantity: Number.isFinite(qty) ? qty : 0 }
          : line,
      ),
    );
  }

  removeLine(itemId: string) {
    this.lines.update((curr) => curr.filter((line) => line.itemId !== itemId));
  }

  statusLabel(status: string | null | undefined): string {
    const s = String(status ?? '').toUpperCase();
    if (s === 'EN_TRANSIT' || s === 'IN_TRANSIT' || s === 'SENT' || s === 'SHIPPED') {
      return 'En Tránsito';
    }
    if (s === 'RECEIVED' || s === 'COMPLETED') {
      return 'Recibido';
    }
    if (s === 'CANCELLED') {
      return 'Cancelado';
    }
    return s || '—';
  }

  statusBadgeClass(status: string | null | undefined): string {
    const label = this.statusLabel(status);
    if (label === 'En Tránsito') {
      return 'bg-amber-500/15 border border-amber-500/30 text-amber-300';
    }
    if (label === 'Recibido') {
      return 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-300';
    }
    if (label === 'Cancelado') {
      return 'bg-error/15 border border-error/30 text-error';
    }
    return 'bg-dark border border-border text-muted';
  }

  isReceivable(transfer: InventoryTransferRow): boolean {
    return this.statusLabel(transfer.status) === 'En Tránsito';
  }

  canConfirmReception(transfer: InventoryTransferRow): boolean {
    if (!this.isReceivable(transfer)) return false;
    const destinationId = transfer.destinationWarehouse?.id;
    if (!destinationId) return false;
    // Solo habilitamos recepción si la bodega destino está dentro del alcance del usuario.
    return this.warehouses().some((w) => w.id === destinationId);
  }

  requestSendTransfer() {
    if (!this.canSubmit()) {
      this.notificationService.info('Complete origen, destino e ítems válidos antes de enviar.');
      return;
    }
    const v = this.transferForm.getRawValue();
    const origin = this.warehouses().find((w) => w.id === v.originWarehouseId);
    const destination = this.warehouses().find((w) => w.id === v.destinationWarehouseId);
    this.pendingAction.set({ type: 'send' });
    this.confirmTitle.set('Confirmar envío de transferencia');
    this.confirmText.set('Sí, enviar');
    this.confirmSummary.set(
      `Se trasladarán ${this.lines().length} ítem(s) desde ${origin?.code ?? 'origen'} hacia ${destination?.code ?? 'destino'}.`,
    );
    this.confirmOpen.set(true);
  }

  requestConfirmReception(transfer: InventoryTransferRow) {
    this.pendingAction.set({ type: 'receive', transfer });
    this.confirmTitle.set('Confirmar recepción de transferencia');
    this.confirmText.set('Sí, confirmar recepción');
    this.confirmSummary.set(
      `Se cerrará la recepción de la transferencia ${transfer.id.slice(0, 8)} y se consolidará su impacto en valorización.`,
    );
    this.confirmOpen.set(true);
  }

  cancelConfirm() {
    this.confirmOpen.set(false);
    this.pendingAction.set(null);
    this.confirmSummary.set('');
  }

  confirmAction() {
    const action = this.pendingAction();
    this.confirmOpen.set(false);
    if (!action) return;
    if (action.type === 'send') {
      this.submitTransfer();
      return;
    }
    this.confirmReception(action.transfer);
  }

  private submitTransfer() {
    const v = this.transferForm.getRawValue();
    this.transferService
      .createTransfer({
        originWarehouseId: String(v.originWarehouseId),
        destinationWarehouseId: String(v.destinationWarehouseId),
        lines: this.lines().map((line) => ({
          itemId: line.itemId,
          quantity: Number(line.quantity),
        })),
      })
      .subscribe({
        next: () => {
          this.notificationService.success('Transferencia enviada exitosamente.');
          this.lines.set([]);
          this.transferForm.patchValue({ destinationWarehouseId: '' });
          this.loadTransfers();
        },
        error: (err) => {
          this.notificationService.error(
            err?.error?.message || 'No se pudo enviar la transferencia.',
          );
        },
      });
  }

  private confirmReception(transfer: InventoryTransferRow) {
    this.transferService.confirmReception(transfer.id).subscribe({
      next: () => {
        this.notificationService.success('Recepción confirmada.');
        this.loadTransfers();
      },
      error: (err) => {
        this.notificationService.error(
          err?.error?.message || 'No se pudo confirmar la recepción.',
        );
      },
    });
  }
}
