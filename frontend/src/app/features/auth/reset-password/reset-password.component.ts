import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute, Router } from '@angular/router';
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators,
  AbstractControl,
  ValidationErrors,
} from '@angular/forms';
import { AuthService } from '../../../core/services/auth/auth.service';

function passwordMatchValidator(
  control: AbstractControl,
): ValidationErrors | null {
  const newPass = control.get('newPassword')?.value;
  const confPass = control.get('confirmPassword')?.value;
  if (newPass && confPass && newPass !== confPass) {
    return { passwordMismatch: true };
  }
  return null;
}

@Component({
  selector: 'app-reset-password',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule],
  template: `
    <div
      class="h-screen w-full flex items-center justify-center bg-[#0a0f1a] relative overflow-hidden"
    >
      <div
        class="absolute w-[600px] h-[600px] bg-primary/20 rounded-full blur-[120px] top-[-100px] left-[-100px]"
      ></div>
      <div
        class="absolute w-[500px] h-[500px] bg-blue-500/10 rounded-full blur-[100px] bottom-[-100px] right-[-100px]"
      ></div>

      <div
        class="z-10 w-full max-w-md p-8 bg-dark backdrop-blur-xl border border-border rounded-2xl shadow-2xl animate-fade-in-up"
      >
        <div class="mb-8 text-center">
          <h2
            class="text-3xl font-extrabold text-main tracking-tight uppercase"
          >
            Nueva Clave
          </h2>
          <p class="text-muted mt-2 text-sm">
            Ingresa tu nueva contraseña para acceder
          </p>
        </div>

        @if (errorMessage()) {
          <div
            class="mb-6 bg-red-500/10 border-l-4 border-red-500 p-4 rounded-r-lg text-red-500 text-sm"
          >
            {{ errorMessage() }}
          </div>
        }

        @if (successMessage()) {
          <div
            class="mb-6 bg-success/10 border-l-4 border-success p-4 rounded-r-lg"
          >
            <p class="text-success text-sm font-medium">
              {{ successMessage() }}
            </p>
            <button
              routerLink="/auth/login"
              class="mt-3 btn-primary text-xs py-2 px-4"
            >
              Ir a Iniciar Sesión
            </button>
          </div>
        } @else {
          <form
            [formGroup]="resetForm"
            (ngSubmit)="onSubmit()"
            class="space-y-6"
          >
            <div class="space-y-1">
              <label
                for="newPassword"
                class="text-xs font-semibold text-muted uppercase tracking-wider"
                >Nueva Contraseña</label
              >
              <div class="relative">
                <input
                  type="password"
                  id="newPassword"
                  formControlName="newPassword"
                  class="w-full bg-dark border border-border rounded-md p-2.5 text-main focus:border-primary outline-none transition-all"
                  placeholder="••••••••"
                />
              </div>
              @if (
                resetForm.get('newPassword')?.touched &&
                resetForm.get('newPassword')?.hasError('minlength')
              ) {
                <p class="text-red-400 text-xs mt-1">
                  Debe tener al menos 8 caracteres.
                </p>
              }
            </div>

            <div class="space-y-1">
              <label
                for="confirmPassword"
                class="text-xs font-semibold text-muted uppercase tracking-wider"
                >Confirmar Contraseña</label
              >
              <div class="relative">
                <input
                  type="password"
                  id="confirmPassword"
                  formControlName="confirmPassword"
                  class="w-full bg-dark border border-border rounded-md p-2.5 text-main focus:border-primary outline-none transition-all"
                  placeholder="••••••••"
                />
              </div>
              @if (
                resetForm.touched && resetForm.hasError('passwordMismatch')
              ) {
                <p class="text-red-400 text-xs mt-1">
                  Las contraseñas no coinciden.
                </p>
              }
            </div>

            <button
              type="submit"
              [disabled]="resetForm.invalid || isLoading()"
              class="w-full bg-primary hover:bg-primary/90 text-dark font-bold py-3 text-sm flex justify-center items-center gap-2 rounded-md transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              @if (isLoading()) {
                <svg class="animate-spin h-5 w-5" viewBox="0 0 24 24">
                  <circle
                    class="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    stroke-width="4"
                    fill="none"
                  ></circle>
                  <path
                    class="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  ></path>
                </svg>
                Restableciendo...
              } @else {
                GUARDAR CONTRASEÑA
              }
            </button>
          </form>
        }
      </div>
    </div>
  `,
})
export class ResetPasswordComponent implements OnInit {
  private fb = inject(FormBuilder);
  private authService = inject(AuthService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  token: string | null = null;
  isLoading = signal(false);
  successMessage = signal<string | null>(null);
  errorMessage = signal<string | null>(null);

  resetForm = this.fb.group(
    {
      newPassword: ['', [Validators.required, Validators.minLength(8)]],
      confirmPassword: ['', [Validators.required]],
    },
    { validators: passwordMatchValidator },
  );

  ngOnInit() {
    this.token = this.route.snapshot.queryParamMap.get('token');
    if (!this.token) {
      this.errorMessage.set(
        'El enlace de restablecimiento es inválido o no posee token.',
      );
    }
  }

  onSubmit() {
    if (this.resetForm.valid && this.token) {
      this.isLoading.set(true);
      this.errorMessage.set(null);

      const newPassword = this.resetForm.value.newPassword!;

      this.authService.resetPassword(this.token, newPassword).subscribe({
        next: (res: any) => {
          this.successMessage.set(
            res.message || 'Contraseña restablecida con éxito',
          );
          this.isLoading.set(false);
        },
        error: (err: any) => {
          this.errorMessage.set(
            err.error?.message ||
              'Error al restablecer la contraseña. El enlace puede haber expirado.',
          );
          this.isLoading.set(false);
        },
      });
    }
  }
}

