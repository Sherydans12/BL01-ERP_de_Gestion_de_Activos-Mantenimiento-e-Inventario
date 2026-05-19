import { Component, signal, computed, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { PurchasesService, PurchaseOrder } from '../../../core/services/purchases/purchases.service';
import { WarehousesService } from '../../../core/services/warehouses/warehouses.service';
import { NotificationService } from '../../../core/services/notification/notification.service';
import { PurchasesPushNoticeComponent } from '../../../shared/components/purchases-push-notice/purchases-push-notice.component';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { P } from '../../../core/constants/purchases-permissions';

@Component({
  selector: 'app-receipt-create',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    PurchasesPushNoticeComponent,
    HasPermissionDirective,
  ],
  templateUrl: './receipt-create.component.html',
})
export class ReceiptCreateComponent implements OnInit {
  protected readonly p = P;

  private purchasesService = inject(PurchasesService);
  private warehousesService = inject(WarehousesService);
  private notify = inject(NotificationService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  orders = signal<PurchaseOrder[]>([]);
  warehouses = signal<Array<{ id: string; code: string; name: string }>>([]);

  selectedOrderId = signal('');
  selectedWarehouseId = signal('');

  isLoadingOrders = signal(true);
  isLoadingWarehouses = signal(false);
  isSubmitting = signal(false);

  selectedOrder = computed(() => {
    const id = this.selectedOrderId();
    return this.orders().find((o) => o.id === id) ?? null;
  });

  statusLabel: Record<string, string> = {
    SENT: 'Enviada al proveedor',
    ORDERED: 'Pedida al proveedor',
    SENT_TO_SUPPLIER: 'Enviada al proveedor (hist.)',
    PARTIALLY_RECEIVED: 'Parcialmente recibida',
  };

  ngOnInit() {
    const pre = this.route.snapshot.queryParamMap.get('orderId')?.trim();
    this.purchasesService.getOrdersEligibleForReceipt().subscribe({
      next: (list) => {
        this.orders.set(list);
        this.isLoadingOrders.set(false);
        if (pre && list.some((o) => o.id === pre)) {
          this.selectedOrderId.set(pre);
          this.loadWarehousesForOrder(pre);
        }
      },
      error: (err: unknown) => {
        const msg =
          err && typeof err === 'object' && 'error' in err
            ? (err as { error?: { message?: string } }).error?.message
            : undefined;
        this.notify.error(typeof msg === 'string' ? msg : 'Error al cargar órdenes elegibles');
        this.isLoadingOrders.set(false);
      },
    });
  }

  onOrderChange(id: string) {
    this.selectedOrderId.set(id);
    this.selectedWarehouseId.set('');
    this.warehouses.set([]);
    if (!id) return;
    this.loadWarehousesForOrder(id);
  }

  private loadWarehousesForOrder(orderId: string) {
    const po = this.orders().find((o) => o.id === orderId);
    const cid = po?.contractId;
    if (!cid) return;
    this.isLoadingWarehouses.set(true);
    this.warehousesService.getWarehousesByContract(cid).subscribe({
      next: (list) => {
        const normalized = (list ?? []).map((w: { id: string; code?: string; name?: string }) => ({
          id: w.id,
          code: w.code ?? '',
          name: w.name ?? '',
        }));
        this.warehouses.set(normalized);
        this.isLoadingWarehouses.set(false);
        if (normalized.length === 1) {
          this.selectedWarehouseId.set(normalized[0].id);
        }
      },
      error: () => {
        this.notify.error('Error al cargar bodegas del contrato');
        this.isLoadingWarehouses.set(false);
      },
    });
  }

  submit() {
    const oid = this.selectedOrderId().trim();
    const wid = this.selectedWarehouseId().trim();
    if (!oid || !wid) {
      this.notify.warning('Seleccione orden de compra y bodega de recepción');
      return;
    }
    const po = this.selectedOrder();
    const n = po?._count?.items ?? 0;
    if (n <= 0) {
      this.notify.error('Esta OC no tiene líneas; no se puede recepcionar.');
      return;
    }
    this.isSubmitting.set(true);
    this.purchasesService.createReceipt({ purchaseOrderId: oid, warehouseId: wid }).subscribe({
      next: (receipt) => {
        this.notify.success(`Recepción ${receipt.correlative} creada. Ingrese cantidades recibidas.`);
        this.isSubmitting.set(false);
        this.router.navigate(['/app/compras/recepciones', receipt.id]);
      },
      error: (err: unknown) => {
        const msg =
          err && typeof err === 'object' && 'error' in err
            ? (err as { error?: { message?: string } }).error?.message
            : undefined;
        this.notify.error(typeof msg === 'string' ? msg : 'Error al crear recepción');
        this.isSubmitting.set(false);
      },
    });
  }
}
