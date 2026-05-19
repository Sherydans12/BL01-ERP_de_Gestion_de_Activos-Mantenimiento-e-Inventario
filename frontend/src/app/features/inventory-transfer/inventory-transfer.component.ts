import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { merge } from 'rxjs';
import { AuthService } from '../../core/services/auth/auth.service';
import {
  InventoryTransferDetail,
  InventoryTransferRow,
  InventoryTransferService,
  TransferLineDetail,
} from '../../core/services/inventory-transfer/inventory-transfer.service';
import { NotificationService } from '../../core/services/notification/notification.service';
import { WarehousesService } from '../../core/services/warehouses/warehouses.service';
import { ItemPickerRow } from '../../core/services/inventory-items/inventory-items.service';
import { ConfirmModalComponent } from '../../shared/components/confirm-modal/confirm-modal.component';
import { GlobalItemPickerComponent } from '../../shared/components/global-item-picker/global-item-picker.component';
import {
  HasPermissionDirective,
} from '../../shared/directives/has-permission.directive';
import { I } from '../../core/constants/inventory-permissions';

type DraftLine = {
  itemId: string;
  /** SKU / código de inventario (si existe). */
  inventoryCode: string | null;
  partNumber: string;
  name: string;
  brand: string | null;
  unitOfMeasure: string;
  allowsDecimals: boolean;
  quantity: number;
  /** Saldo físico en bodega origen al momento de elegir el ítem (picker). */
  originStockPhysical: number | null;
  stockLocation: string | null;
  stockCritical: boolean;
};

type PendingAction =
  | { type: 'send' }
  | { type: 'receive'; transfer: InventoryTransferRow };

type ListSortKey = 'createdAt' | 'origin' | 'dest' | 'status';

@Component({
  selector: 'app-inventory-transfer',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    RouterLink,
    ConfirmModalComponent,
    GlobalItemPickerComponent,
    HasPermissionDirective,
  ],
  templateUrl: './inventory-transfer.component.html',
})
export class InventoryTransferComponent implements OnInit {
  protected readonly i = I;

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
  transfersTotal = signal(0);
  transfersPage = signal(1);
  transfersPageSize = signal(25);
  listSortKey = signal<ListSortKey>('createdAt');
  listSortDir = signal<'asc' | 'desc'>('desc');
  transfersLoading = signal(true);
  lines = signal<DraftLine[]>([]);
  pickerOpen = signal(false);

  detailOpen = signal(false);
  detailLoading = signal(false);
  detailTransfer = signal<InventoryTransferDetail | null>(null);

  confirmOpen = signal(false);
  confirmTitle = signal('Confirmar acción');
  confirmText = signal('Confirmar');
  confirmSummary = signal('');
  pendingAction = signal<PendingAction | null>(null);

  transferForm = this.fb.group({
    originWarehouseId: ['', Validators.required],
    destinationWarehouseId: ['', Validators.required],
  });

  /**
   * Los Reactive Forms no notifican a `computed()` por sí solos.
   * Cada emisión de value/status invalida el grafo de señales.
   */
  private formRevision = signal(0);

  readonly transfersTotalPages = computed(() =>
    Math.max(1, Math.ceil(this.transfersTotal() / this.transfersPageSize())),
  );

  /** Bodega origen para el picker (lectura reactiva al formulario). */
  originWarehouseIdForPicker = computed(() => {
    this.formRevision();
    const v = this.transferForm.get('originWarehouseId')?.value;
    return v && String(v).trim() ? String(v).trim() : null;
  });

  canSubmit = computed(() => {
    this.formRevision();
    const v = this.transferForm.getRawValue();
    return (
      this.transferForm.valid &&
      !!v.originWarehouseId &&
      !!v.destinationWarehouseId &&
      v.originWarehouseId !== v.destinationWarehouseId &&
      this.lines().length > 0 &&
      this.lines().every((l) => l.quantity > 0 && !this.exceedsOriginStock(l))
    );
  });

  constructor() {
    merge(this.transferForm.valueChanges, this.transferForm.statusChanges)
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.formRevision.update((n) => n + 1));

    effect(
      () => {
        this.authService.currentContractId();
        this.loadWarehouses();
      },
      { allowSignalWrites: true },
    );

    effect(
      () => {
        this.transfersPage();
        this.transfersPageSize();
        this.listSortKey();
        this.listSortDir();
        this.loadTransfers();
      },
      { allowSignalWrites: true },
    );
  }

  ngOnInit(): void {
    queueMicrotask(() => this.formRevision.update((n) => n + 1));
  }

  loadWarehouses() {
    this.warehousesLoading.set(true);
    this.warehousesService.getWarehouses().subscribe({
      next: (rows) => {
        this.warehouses.set(rows);
        this.warehousesLoading.set(false);
        const origen = this.route.snapshot.queryParamMap.get('origen');
        if (origen && rows.some((w) => w.id === origen)) {
          this.transferForm.patchValue({ originWarehouseId: origen });
          this.formRevision.update((n) => n + 1);
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
    this.transferService
      .listTransfers({
        page: this.transfersPage(),
        pageSize: this.transfersPageSize(),
        sort: this.listSortKey(),
        dir: this.listSortDir(),
      })
      .subscribe({
        next: (res) => {
          this.transfers.set(res?.data ?? []);
          this.transfersTotal.set(res?.total ?? 0);
          this.transfersLoading.set(false);
        },
        error: () => {
          this.transfers.set([]);
          this.transfersTotal.set(0);
          this.transfersLoading.set(false);
          this.notificationService.error('No se pudieron cargar las transferencias.');
        },
      });
  }

  toggleSort(field: ListSortKey) {
    if (this.listSortKey() === field) {
      this.listSortDir.update((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      this.listSortKey.set(field);
      this.listSortDir.set(field === 'createdAt' ? 'desc' : 'asc');
    }
    this.transfersPage.set(1);
  }

  sortIndicator(field: ListSortKey): string {
    if (this.listSortKey() !== field) return '';
    return this.listSortDir() === 'asc' ? '↑' : '↓';
  }

  transfersPrevPage() {
    if (this.transfersPage() <= 1) return;
    this.transfersPage.update((p) => p - 1);
  }

  transfersNextPage() {
    if (this.transfersPage() >= this.transfersTotalPages()) return;
    this.transfersPage.update((p) => p + 1);
  }

  openDetail(row: InventoryTransferRow) {
    this.detailOpen.set(true);
    this.detailLoading.set(true);
    this.detailTransfer.set(null);
    this.transferService.getTransfer(row.id).subscribe({
      next: (d) => {
        this.detailTransfer.set(d);
        this.detailLoading.set(false);
      },
      error: (err) => {
        this.detailLoading.set(false);
        this.detailOpen.set(false);
        this.notificationService.error(
          err?.error?.message || 'No se pudo cargar el detalle de la transferencia.',
        );
      },
    });
  }

  closeDetail() {
    this.detailOpen.set(false);
    this.detailTransfer.set(null);
    this.detailLoading.set(false);
  }

  lineQtyDisplay(line: TransferLineDetail): string {
    const dec = line.item?.unitOfMeasure?.allowsDecimals ?? false;
    const q = line.quantity;
    if (!Number.isFinite(q)) return '—';
    if (dec) {
      return new Intl.NumberFormat('es-CL', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 3,
      }).format(q);
    }
    return String(Math.floor(q));
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
    const allowsDecimals = row.unitOfMeasure?.allowsDecimals ?? false;
    const invCode = row.inventoryCode?.trim() || null;
    const brand = row.brand?.trim() || null;
    const loc = row.stockLocation?.trim() || null;
    const stockPhys =
      row.stockQuantity != null && Number.isFinite(Number(row.stockQuantity))
        ? Number(row.stockQuantity)
        : null;
    const critical = !!row.stockCritical;

    this.lines.update((curr) => {
      const idx = curr.findIndex((line) => line.itemId === row.id);
      if (idx >= 0) {
        const updated = [...curr];
        const prev = updated[idx];
        updated[idx] = {
          ...prev,
          quantity: prev.quantity + 1,
          originStockPhysical: stockPhys ?? prev.originStockPhysical,
          stockLocation: loc || prev.stockLocation,
          stockCritical: critical || prev.stockCritical,
        };
        return updated;
      }
      return [
        ...curr,
        {
          itemId: row.id,
          inventoryCode: invCode,
          partNumber: row.partNumber?.trim() || '—',
          name: row.name,
          brand,
          unitOfMeasure: row.unitOfMeasure?.abbreviation ?? 'UN',
          allowsDecimals,
          quantity: 1,
          originStockPhysical: stockPhys,
          stockLocation: loc,
          stockCritical: critical,
        },
      ];
    });
  }

  /** Saldo estimado en origen después de descontar la cantidad a transferir. */
  remainingOriginStock(line: DraftLine): number | null {
    if (line.originStockPhysical == null) return null;
    const r = line.originStockPhysical - line.quantity;
    return line.allowsDecimals ? Math.max(0, r) : Math.max(0, Math.floor(r));
  }

  /** Cantidad a enviar supera el saldo físico mostrado (el backend valida igual). */
  exceedsOriginStock(line: DraftLine): boolean {
    if (line.originStockPhysical == null) return false;
    return line.quantity > line.originStockPhysical + 1e-9;
  }

  setLineQty(itemId: string, value: string) {
    const raw = Number(value);
    this.lines.update((curr) =>
      curr.map((line) => {
        if (line.itemId !== itemId) return line;
        let qty = Number.isFinite(raw) ? raw : 0;
        if (!line.allowsDecimals) qty = Math.floor(qty);
        return { ...line, quantity: qty };
      }),
    );
  }

  /** Cantidad solo enteros: evita `type="number"` que muestra decimales en el navegador. */
  setLineQtyInteger(itemId: string, value: string) {
    const digits = String(value ?? '').replace(/\D/g, '');
    const qty = digits === '' ? 0 : Number.parseInt(digits, 10);
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

  /**
   * Alineado al backend (`canAccessContract` sobre la bodega destino).
   * No usar solo la lista de bodegas del contrato activo del header: una transferencia
   * puede tener destino en otro contrato y el ADMIN igual debe poder confirmar.
   */
  canConfirmReception(transfer: InventoryTransferRow): boolean {
    if (!this.authService.hasPermission(I.TRANSFER_APPROVE)) return false;
    if (!this.isReceivable(transfer)) return false;
    const destContractId = transfer.destinationWarehouse?.contractId;
    if (!destContractId) return false;
    const user = this.authService.currentUser();
    if (!user) return false;
    const role = String(user.role ?? '').toUpperCase();
    if (role === 'ADMIN' || role === 'SUPER_ADMIN') return true;
    const allowed = user.allowedContracts ?? [];
    return allowed.includes(destContractId);
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
          this.transfersPage.set(1);
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
        if (this.detailOpen() && this.detailTransfer()?.id === transfer.id) {
          this.openDetail(transfer);
        }
      },
      error: (err) => {
        this.notificationService.error(
          err?.error?.message || 'No se pudo confirmar la recepción.',
        );
      },
    });
  }
}
