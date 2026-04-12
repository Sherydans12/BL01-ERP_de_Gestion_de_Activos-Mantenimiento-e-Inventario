import { Component, signal, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { VendorsService, Vendor } from '../../../core/services/vendors/vendors.service';
import { NotificationService } from '../../../core/services/notification/notification.service';

@Component({
  selector: 'app-vendor-list',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  templateUrl: './vendor-list.component.html',
})
export class VendorListComponent {
  private vendorsService = inject(VendorsService);
  private notify = inject(NotificationService);

  vendors = signal<Vendor[]>([]);
  isLoading = signal(false);
  searchTerm = signal('');
  showInactive = signal(false);

  filteredVendors = computed(() => {
    const search = this.searchTerm().toLowerCase();
    const active = this.showInactive();
    return this.vendors().filter((v) => {
      const matchSearch =
        !search || v.name.toLowerCase().includes(search) || v.code.toLowerCase().includes(search);
      const matchActive = active || v.isActive;
      return matchSearch && matchActive;
    });
  });

  constructor() {
    this.loadVendors();
  }

  loadVendors() {
    this.isLoading.set(true);
    this.vendorsService.getAll().subscribe({
      next: (data) => { this.vendors.set(data); this.isLoading.set(false); },
      error: () => { this.notify.error('Error al cargar proveedores'); this.isLoading.set(false); },
    });
  }

  deactivate(vendor: Vendor) {
    this.vendorsService.remove(vendor.id).subscribe({
      next: () => { this.notify.success('Proveedor desactivado'); this.loadVendors(); },
      error: () => this.notify.error('Error al desactivar proveedor'),
    });
  }
}
