import { Component, inject } from '@angular/core';
import {
  FormBuilder,
  FormGroup,
  Validators,
  ReactiveFormsModule,
} from '@angular/forms';
import { CommonModule } from '@angular/common';
import { TenantService } from '../../../core/services/tenant/tenant.service';
import { Router } from '@angular/router';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
})
export class LoginComponent {
  private fb = inject(FormBuilder);
  private tenantService = inject(TenantService);
  private router = inject(Router);

  loginForm: FormGroup = this.fb.group({
    tenantCode: ['TPM', [Validators.required]], // Código de empresa (Multi-tenant)
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(6)]],
  });

  isSubmitting = false;

  onSubmit() {
    if (this.loginForm.invalid) return;

    this.isSubmitting = true;
    const { tenantCode, email, password } = this.loginForm.value;

    // Aquí simularemos el flujo. Más adelante llamaremos al AuthService.
    console.log('Iniciando sesión en entorno:', tenantCode);
    console.log('Credenciales:', { email, password });

    setTimeout(() => {
      this.tenantService.setTenant({
        id: tenantCode,
        name: 'TPM Minería',
        logoUrl: '',
      });
      this.isSubmitting = false;
      // Redirigir al área de la app
      this.router.navigate(['/app/dashboard']);
    }, 1000);
  }
}
