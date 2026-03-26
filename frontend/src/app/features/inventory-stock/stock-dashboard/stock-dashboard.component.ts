import { Component, inject, signal, effect, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormBuilder,
  FormGroup,
  Validators,
  ReactiveFormsModule,
} from '@angular/forms';
import { InventoryStockService } from '../../../core/services/inventory-stock/inventory-stock.service';
import { WarehousesService } from '../../../core/services/warehouses/warehouses.service';
import { InventoryItemsService } from '../../../core/services/inventory-items/inventory-items.service';
import { NotificationService } from '../../../core/services/notification/notification.service';
import { AuthService } from '../../../core/services/auth/auth.service';

@Component({
  selector: 'app-stock-dashboard',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './stock-dashboard.component.html',
})
export class StockDashboardComponent implements OnInit {
  private stockService = inject(InventoryStockService);
  private warehousesService = inject(WarehousesService);
  private itemsService = inject(InventoryItemsService);
  private notificationService = inject(NotificationService);
  private authService = inject(AuthService);
  private fb = inject(FormBuilder);

  warehouses = signal<any[]>([]);
  selectedWarehouseId = signal<string>('');

  stockItems = signal<any[]>([]);
  catalogItems = signal<any[]>([]);
  pendingRegularizationCount = signal<number>(0);

  showTransactionModal = signal(false);
  transactionForm: FormGroup;

  constructor() {
    this.transactionForm = this.fb.group({
      type: ['IN', Validators.required],
      itemId: ['', Validators.required],
      quantity: [1, [Validators.required, Validators.min(0.01)]],
      unitCost: [0], // Solo para ingresos
      notes: [''],
    });

    // Reactividad multifaena
    effect(
      () => {
        const currentContract = this.authService.currentContractId();
        this.loadWarehouses();
        this.selectedWarehouseId.set('');
        this.stockItems.set([]);
      },
      { allowSignalWrites: true },
    );
  }

  ngOnInit() {
    this.itemsService.getItems().subscribe((res) => this.catalogItems.set(res));
    this.stockService.getPendingCount().subscribe({
      next: (count) => this.pendingRegularizationCount.set(count),
      error: () => this.pendingRegularizationCount.set(0),
    });
  }

  loadWarehouses() {
    this.warehousesService.getWarehouses().subscribe({
      next: (data) => this.warehouses.set(data),
      error: () => this.notificationService.error('Error al cargar bodegas'),
    });
  }

  onWarehouseSelect(event: Event) {
    const wId = (event.target as HTMLSelectElement).value;
    this.selectedWarehouseId.set(wId);
    if (wId) {
      this.loadStock(wId);
    } else {
      this.stockItems.set([]);
    }
  }

  loadStock(warehouseId: string) {
    this.stockService.getStockByWarehouse(warehouseId).subscribe({
      next: (data) => this.stockItems.set(data),
      error: () => this.notificationService.error('Error al cargar stock'),
    });
  }

  openTransactionModal() {
    if (!this.selectedWarehouseId()) {
      this.notificationService.info('Selecciona una bodega primero.');
      return;
    }
    this.transactionForm.reset({ type: 'IN', quantity: 1, unitCost: 0 });
    this.showTransactionModal.set(true);
  }

  closeTransactionModal() {
    this.showTransactionModal.set(false);
  }

  submitTransaction() {
    if (this.transactionForm.invalid) {
      this.transactionForm.markAllAsTouched();
      return;
    }

    const payload = {
      ...this.transactionForm.value,
      warehouseId: this.selectedWarehouseId(),
    };

    this.stockService.performTransaction(payload).subscribe({
      next: () => {
        this.notificationService.success('Movimiento registrado exitosamente.');
        this.closeTransactionModal();
        this.loadStock(this.selectedWarehouseId()); // Recargar tabla
      },
      error: (err) =>
        this.notificationService.error(
          err.error?.message || 'Error en la transacción.',
        ),
    });
  }
}
