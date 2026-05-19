import { Component, inject, signal, effect, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { WarehousesService } from '../../../core/services/warehouses/warehouses.service';
import { NotificationService } from '../../../core/services/notification/notification.service';
import { AuthService } from '../../../core/services/auth/auth.service';
import { SkeletonRowComponent } from '../../../shared/components/skeleton-row/skeleton-row.component';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { I } from '../../../core/constants/inventory-permissions';

@Component({
  selector: 'app-warehouse-list',
  standalone: true,
  imports: [CommonModule, RouterLink, SkeletonRowComponent, HasPermissionDirective],
  templateUrl: './warehouse-list.component.html',
})
export class WarehouseListComponent implements OnInit {
  protected readonly i = I;

  private warehousesService = inject(WarehousesService);
  private notificationService = inject(NotificationService);
  private authService = inject(AuthService);

  warehouses = signal<any[]>([]);
  isLoading = signal(true);
  readonly tableSkeletonRows = Array.from({ length: 6 }, (_, i) => i);

  constructor() {
    // Reactividad multifaena: recarga al cambiar el selector superior
    effect(
      () => {
        this.authService.currentContractId();
        this.loadWarehouses();
      },
      { allowSignalWrites: true },
    );
  }

  ngOnInit() {}

  loadWarehouses() {
    this.isLoading.set(true);
    this.warehousesService.getWarehouses().subscribe({
      next: (data) => {
        this.warehouses.set(data);
        this.isLoading.set(false);
      },
      error: (err) => {
        console.error('Error al cargar bodegas', err);
        this.isLoading.set(false);
      },
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
