import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { InventoryItemsService } from '../../../core/services/inventory-items/inventory-items.service';
import { NotificationService } from '../../../core/services/notification/notification.service';

@Component({
  selector: 'app-inventory-item-list',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './inventory-item-list.component.html',
})
export class InventoryItemListComponent implements OnInit {
  private inventoryItemsService = inject(InventoryItemsService);
  private notificationService = inject(NotificationService);

  items = signal<any[]>([]);

  ngOnInit() {
    this.loadItems();
  }

  loadItems() {
    this.inventoryItemsService.getItems().subscribe({
      next: (data) => this.items.set(data),
      error: (err) => console.error('Error al cargar artículos', err),
    });
  }

  deleteItem(id: string, partNumber: string) {
    if (confirm(`¿Estás seguro de eliminar el artículo N/P: ${partNumber}?`)) {
      this.inventoryItemsService.deleteItem(id).subscribe({
        next: () => {
          this.notificationService.success('Artículo eliminado exitosamente.');
          this.loadItems();
        },
        error: (err) => {
          this.notificationService.error(
            err.error?.message || 'Error al eliminar el artículo.',
          );
        },
      });
    }
  }
}
