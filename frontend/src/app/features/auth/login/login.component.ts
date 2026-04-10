import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { AuthService } from '../../../core/services/auth/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule],
  template: `
    <div
      class="min-h-screen flex items-center justify-center p-4 bg-surface overflow-hidden relative"
    >
      <!-- Decoración de fondo -->
      <div
        class="absolute top-[-10%] right-[-10%] w-96 h-96 bg-primary/10 rounded-full blur-[120px]"
      ></div>
      <div
        class="absolute bottom-[-10%] left-[-10%] w-96 h-96 bg-blue-500/10 rounded-full blur-[120px]"
      ></div>

      <div
        class="w-full max-w-md bg-surface/50 backdrop-blur-xl border border-border rounded-2xl shadow-2xl overflow-hidden z-10"
      >
        <div class="p-8 border-b border-border/50 text-center">
          <div
            class="inline-flex items-center justify-center w-14 h-14 bg-surface border border-primary/30 rounded-xl mb-4 shadow-[0_0_20px_rgba(0,229,255,0.15)]"
          >
            <span class="text-primary font-mono text-2xl font-bold italic"
              >TPM</span
            >
          </div>
          <h2 class="text-2xl font-bold text-main tracking-tight">
            Acceso Operativo
          </h2>
          <p class="text-sm text-muted mt-2">
            ERP Gestión de Activos y Mantenimiento
          </p>
        </div>

        <form
          [formGroup]="loginForm"
          (ngSubmit)="onSubmit()"
          class="p-8 space-y-6"
        >
          <div>
            <label
              for="tenantCode"
              class="block text-sm font-medium text-muted mb-1"
              >ID de Empresa / Contrato</label
            >
            <div class="relative">
              <span
                class="absolute left-3 top-1/2 -translate-y-1/2 text-muted font-mono text-sm"
                >&#64;</span
              >
              <input
                type="text"
                id="tenantCode"
                formControlName="tenantCode"
                class="w-full pl-8 py-2.5 font-mono uppercase tracking-wider text-primary bg-surface border border-border rounded-lg focus:border-primary focus:ring-1 focus:ring-primary/50 outline-none transition-all placeholder-gray-600"
                placeholder="TPM"
              />
            </div>
          </div>

          <div>
            <label
              for="email"
              class="block text-sm font-medium text-muted mb-1"
              >Correo Electrónico</label
            >
            <input
              type="email"
              id="email"
              formControlName="email"
              class="w-full bg-surface border border-border rounded-lg p-2.5 text-main focus:border-primary focus:ring-1 focus:ring-primary/50 outline-none transition-all placeholder-gray-600"
              placeholder="admin@tpm.cl"
            />
          </div>

          <div>
            <div class="flex justify-between items-center mb-1">
              <label for="password" class="text-sm font-medium text-muted"
                >Contraseña</label
              >
              <a
                routerLink="/auth/forgot-password"
                class="text-xs text-primary hover:text-main transition-colors"
                >¿Olvidaste tu clave?</a
              >
            </div>
            <input
              type="password"
              id="password"
              formControlName="password"
              class="w-full bg-surface border border-border rounded-lg p-2.5 text-main focus:border-primary focus:ring-1 focus:ring-primary/50 outline-none transition-all placeholder-gray-600"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            [disabled]="loginForm.invalid || isLoading()"
            class="w-full bg-primary hover:bg-primary/90 text-gray-900 font-bold py-3 px-4 rounded-lg transition-all transform active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed flex justify-center items-center gap-2 shadow-lg shadow-primary/20"
          >
            @if (!isLoading()) {
              <span>INICIAR SESIÓN</span>
            } @else {
              <svg
                class="animate-spin h-5 w-5 text-gray-900"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  class="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  stroke-width="4"
                ></circle>
                <path
                  class="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                ></path>
              </svg>
              <span>AUTENTICANDO...</span>
            }
          </button>
        </form>
      </div>
    </div>
  `,
  styles: [],
})
export class LoginComponent implements OnInit {
  private fb = inject(FormBuilder);
  private authService = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  private returnUrl = '/app/dashboard';

  loginForm = this.fb.nonNullable.group({
    tenantCode: ['TPM', [Validators.required]],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(4)]],
  });

  isLoading = signal(false);

  ngOnInit() {
    // Si ya hay sesión válida, no tiene sentido ver el login: redirigir al dashboard.
    if (this.authService.hasValidSession()) {
      this.router.navigateByUrl('/app/dashboard');
      return;
    }

    // Leer returnUrl del query param que inyecta authGuard.
    // Solo se acepta si empieza con '/' para evitar open redirect a dominios externos.
    const raw = this.route.snapshot.queryParamMap.get('returnUrl') ?? '';
    this.returnUrl = raw.startsWith('/') ? raw : '/app/dashboard';
  }

  onSubmit() {
    if (this.loginForm.valid) {
      this.isLoading.set(true);
      const { tenantCode, email, password } = this.loginForm.getRawValue();

      this.authService.login({ tenantCode, email, password }).subscribe({
        next: () => {
          this.isLoading.set(false);
          this.router.navigateByUrl(this.returnUrl);
        },
        error: () => {
          this.isLoading.set(false);
        },
      });
    }
  }
}

