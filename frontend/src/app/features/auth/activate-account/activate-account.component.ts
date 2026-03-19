import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../../core/services/auth/auth.service';
import { NotificationService } from '../../../core/services/notification/notification.service';

@Component({
  selector: 'app-activate-account',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  template: `
    <div
      class="min-h-screen bg-gray-900 flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8"
    >
      <div
        class="max-w-md w-full space-y-8 bg-gray-800 p-10 rounded-xl shadow-2xl border border-gray-700"
      >
        <div>
          <h2
            class="mt-6 text-center text-3xl font-extrabold text-white tracking-tight"
          >
            Activar Cuenta
          </h2>
          <p class="mt-2 text-center text-sm text-gray-400">
            Define tu nueva contraseña para acceder al sistema TPM.
          </p>
        </div>

        @if (isTokenMissing()) {
          <div class="rounded-md bg-red-900/50 p-4 border border-red-500/50">
            <div class="flex">
              <div class="ml-3">
                <h3 class="text-sm font-medium text-red-400">
                  Enlace inválido
                </h3>
                <div class="mt-2 text-sm text-red-300">
                  <p>No se encontró el token de activación en la URL.</p>
                </div>
              </div>
            </div>
          </div>
        } @else {
          <form
            class="mt-8 space-y-6"
            [formGroup]="activateForm"
            (ngSubmit)="onSubmit()"
          >
            <div class="rounded-md shadow-sm space-y-4">
              <div>
                <label for="password" class="sr-only">Nueva Contraseña</label>
                <input
                  formControlName="password"
                  id="password"
                  type="password"
                  required
                  class="appearance-none rounded-lg relative block w-full px-4 py-3 border border-gray-600 bg-gray-700 text-white placeholder-gray-400 focus:outline-none focus:ring-primary focus:border-primary focus:z-10 sm:text-sm"
                  placeholder="Nueva Contraseña (mínimo 6 caracteres)"
                />
              </div>
              <div>
                <label for="confirmPassword" class="sr-only"
                  >Confirmar Contraseña</label
                >
                <input
                  formControlName="confirmPassword"
                  id="confirmPassword"
                  type="password"
                  required
                  class="appearance-none rounded-lg relative block w-full px-4 py-3 border border-gray-600 bg-gray-700 text-white placeholder-gray-400 focus:outline-none focus:ring-primary focus:border-primary focus:z-10 sm:text-sm"
                  placeholder="Confirmar Contraseña"
                />
              </div>
            </div>

            @if (passwordMismatch()) {
              <p class="text-sm text-red-400 text-center">
                Las contraseñas no coinciden.
              </p>
            }

            <div>
              <button
                type="submit"
                [disabled]="
                  activateForm.invalid || passwordMismatch() || isLoading()
                "
                class="group relative w-full flex justify-center py-3 px-4 border border-transparent text-sm font-bold rounded-lg text-gray-900 bg-primary hover:bg-opacity-90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary focus:ring-offset-gray-900 transition-all disabled:opacity-50 disabled:cursor-not-allowed uppercase tracking-wider"
              >
                @if (isLoading()) {
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
                } @else {
                  ACTIVAR CUENTA
                }
              </button>
            </div>
          </form>
        }
      </div>
    </div>
  `,
  styles: [],
})
export class ActivateAccountComponent implements OnInit {
  private fb = inject(FormBuilder);
  private authService = inject(AuthService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private notification = inject(NotificationService);

  activateForm = this.fb.nonNullable.group({
    password: ['', [Validators.required, Validators.minLength(6)]],
    confirmPassword: ['', [Validators.required]],
  });

  isLoading = signal(false);
  isTokenMissing = signal(false);
  token = '';

  ngOnInit() {
    this.token = this.route.snapshot.queryParamMap.get('token') || '';
    if (!this.token) {
      this.isTokenMissing.set(true);
    }
  }

  passwordMismatch() {
    return (
      this.activateForm.get('password')?.value !==
      this.activateForm.get('confirmPassword')?.value
    );
  }

  onSubmit() {
    if (this.activateForm.valid && !this.passwordMismatch() && this.token) {
      this.isLoading.set(true);
      const { password } = this.activateForm.getRawValue();

      this.authService
        .activateAccount({ token: this.token, password })
        .subscribe({
          next: () => {
            this.isLoading.set(false);
          },
          error: () => {
            this.isLoading.set(false);
          },
        });
    }
  }
}
