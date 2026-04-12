import { Component, signal, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute, RouterModule } from '@angular/router';
import { VendorsService, Vendor } from '../../../core/services/vendors/vendors.service';
import { NotificationService } from '../../../core/services/notification/notification.service';

@Component({
  selector: 'app-vendor-form',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './vendor-form.component.html',
})
export class VendorFormComponent implements OnInit {
  private vendorsService = inject(VendorsService);
  private notify = inject(NotificationService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  vendorId = signal<string | null>(null);
  isEditing = signal(false);
  isSaving = signal(false);

  form = signal({
    code: '',
    name: '',
    rut: '',
    contactName: '',
    contactEmail: '',
    contactPhone: '',
    address: '',
  });

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.vendorId.set(id);
      this.isEditing.set(true);
      this.vendorsService.getById(id).subscribe({
        next: (v) => this.form.set({
          code: v.code, name: v.name, rut: v.rut || '',
          contactName: v.contactName || '', contactEmail: v.contactEmail || '',
          contactPhone: v.contactPhone || '', address: v.address || '',
        }),
        error: () => this.notify.error('Error al cargar proveedor'),
      });
    }
  }

  save() {
    const data = this.form();
    if (!data.code || !data.name) { this.notify.error('Código y nombre son obligatorios'); return; }
    this.isSaving.set(true);

    const obs = this.isEditing()
      ? this.vendorsService.update(this.vendorId()!, data)
      : this.vendorsService.create(data);

    obs.subscribe({
      next: () => {
        this.notify.success(this.isEditing() ? 'Proveedor actualizado' : 'Proveedor creado');
        this.router.navigate(['/app/compras/proveedores']);
      },
      error: (err: any) => {
        this.notify.error(err?.error?.message || 'Error al guardar');
        this.isSaving.set(false);
      },
    });
  }

  updateField(field: string, value: string) {
    this.form.update((f) => ({ ...f, [field]: value }));
  }
}
