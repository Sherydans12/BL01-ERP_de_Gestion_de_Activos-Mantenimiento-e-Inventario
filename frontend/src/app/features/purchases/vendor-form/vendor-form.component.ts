import { Component, signal, computed, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute, RouterModule } from '@angular/router';
import { VendorsService, Vendor } from '../../../core/services/vendors/vendors.service';
import { NotificationService } from '../../../core/services/notification/notification.service';
import {
  HasAnyPermissionDirective,
  HasPermissionDirective,
} from '../../../shared/directives/has-permission.directive';
import { P } from '../../../core/constants/purchases-permissions';
import { AuthService } from '../../../core/services/auth/auth.service';

@Component({
  selector: 'app-vendor-form',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    HasPermissionDirective,
    HasAnyPermissionDirective,
  ],
  templateUrl: './vendor-form.component.html',
})
export class VendorFormComponent implements OnInit {
  protected readonly p = P;

  private auth = inject(AuthService);

  readonly isFormReadOnly = computed(() =>
    this.isEditing()
      ? !this.auth.hasPermission(P.VENDOR_UPDATE)
      : !this.auth.hasPermission(P.VENDOR_CREATE),
  );

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
    businessActivity: '',
    fax: '',
    city: '',
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
          businessActivity: v.businessActivity || '',
          fax: v.fax || '',
          city: v.city || '',
        }),
        error: () => this.notify.error('Error al cargar proveedor'),
      });
    }
  }

  save() {
    if (this.isFormReadOnly()) return;
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
    if (this.isFormReadOnly()) return;
    this.form.update((f) => ({ ...f, [field]: value }));
  }
}
