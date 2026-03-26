import { Component, inject, signal, effect, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { WarehousesService } from '../../../core/services/warehouses/warehouses.service';
import { NotificationService } from '../../../core/services/notification/notification.service';
import { AuthService } from '../../../core/services/auth/auth.service';

@Component({
  selector: 'app-warehouse-list',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './warehouse-list.component.html',
})
export class WarehouseListComponent implements OnInit {
  private warehousesService = inject(WarehousesService);
  private notificationService = inject(NotificationService);
  private authService = inject(AuthService);

  warehouses = signal<any[]>([]);

  constructor() {
    // Reactividad multifaena: recarga al cambiar el selector superior
    effect(() => {
      const currentContract = this.authService.currentContractId();
      this.loadWarehouses();
    });
  }

  ngOnInit() {}

  loadWarehouses() {
    this.warehousesService.getWarehouses().subscribe({
      next: (data) => this.warehouses.set(data),
      error: (err) => console.error('Error al cargar bodegas', err),
    });
  }

  deleteWarehouse(id: string, code: string) {
    if (
      confirm(
        `¿Eliminar la bodega ${code}? Asegúrate de que no tenga stock registrado.`,
      )
    ) {
      this.warehousesService.deleteWarehouse(id).subscribe({
        next: () => {
          this.notificationService.success('Bodega eliminada.');
          this.loadWarehouses();
        },
        error: (err) =>
          this.notificationService.error(
            err.error?.message || 'Error al eliminar.',
          ),
      });
    }
  }
}
