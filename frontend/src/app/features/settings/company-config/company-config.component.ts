import { Component, inject, OnInit, signal } from '@angular/core';
import {
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { CommonModule } from '@angular/common';
import {
  TenantService,
  Tenant,
} from '../../../core/services/tenant/tenant.service';
import { NotificationService } from '../../../core/services/notification/notification.service';

@Component({
  selector: 'app-company-config',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './company-config.component.html',
})
export class CompanyConfigComponent implements OnInit {
  private fb = inject(FormBuilder);
  private tenantService = inject(TenantService);
  private notification = inject(NotificationService);

  configForm: FormGroup;
  isSaving = signal(false);

  constructor() {
    this.configForm = this.fb.group({
      name: ['', Validators.required],
      rut: [''],
      address: [''],
      phone: [''],
      primaryColor: [
        '#00E5FF',
        [Validators.required, Validators.pattern(/^#[0-9a-fA-F]{6}$/i)],
      ],
      backgroundPreference: ['DARK'],
      logoUrl: [''],
    });
  }

  ngOnInit() {
    this.loadConfig();
  }

  loadConfig() {
    // Current config should be in the tenant service signal
    const tenant = this.tenantService.currentTenant();
    if (tenant) {
      this.configForm.patchValue({
        name: tenant.name || '',
        rut: tenant.rut || '',
        address: tenant.address || '',
        phone: tenant.phone || '',
        primaryColor: tenant.primaryColor || '#00E5FF',
        backgroundPreference: tenant.backgroundPreference || 'DARK',
        logoUrl: tenant.logoUrl || '',
      });
    } else {
      // Fetch if not available
      this.tenantService.getTenantConfig().subscribe({
        next: (config: Tenant) => {
          this.tenantService.setTenant(config);
          this.configForm.patchValue({
            name: config.name || '',
            rut: config.rut || '',
            address: config.address || '',
            phone: config.phone || '',
            primaryColor: config.primaryColor || '#00E5FF',
            backgroundPreference: config.backgroundPreference || 'DARK',
            logoUrl: config.logoUrl || '',
          });
        },
      });
    }
  }

  onSubmit() {
    if (this.configForm.invalid) {
      this.notification.error('Formulario inválido. Verifica los campos.');
      return;
    }

    this.isSaving.set(true);
    const data = this.configForm.value;

    this.tenantService.updateTenantConfig(data).subscribe({
      next: (config: Tenant) => {
        // Update local signal to instantly trigger reactivity (via ThemeService)
        this.tenantService.setTenant(config);
        this.notification.success('Configuración actualizada exitosamente');
        this.isSaving.set(false);
      },
      error: () => {
        this.notification.error('Error al actualizar la configuración');
        this.isSaving.set(false);
      },
    });
  }
}
