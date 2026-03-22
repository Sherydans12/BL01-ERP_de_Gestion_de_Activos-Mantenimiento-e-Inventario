import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthService } from '../../../core/services/auth/auth.service';

@Component({
  selector: 'app-forgot-password',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule],
  template: `
    <div
      class="h-screen w-full flex items-center justify-center bg-[#0a0f1a] relative overflow-hidden"
    >
      <!-- Decorative background elements -->
      <div
        class="absolute w-[600px] h-[600px] bg-primary/20 rounded-full blur-[120px] top-[-100px] right-[-100px]"
      ></div>
      <div
        class="absolute w-[500px] h-[500px] bg-blue-500/10 rounded-full blur-[100px] bottom-[-100px] left-[-100px]"
      ></div>

      <div
        class="z-10 w-full max-w-md p-8 bg-dark backdrop-blur-xl border border-border rounded-2xl shadow-2xl animate-fade-in-up"
      >
        <div class="mb-8 text-center">
          <h2
            class="text-3xl font-extrabold text-main tracking-tight uppercase"
          >
            Recuperación
          </h2>
          <p class="text-muted mt-2 text-sm">
            Ingresa tu email para recibir instrucciones
          </p>
        </div>

        <!-- Alert Success -->
        @if (successMessage()) {
          <div
            class="mb-6 bg-success/10 border-l-4 border-success p-4 rounded-r-lg"
          >
            <p class="text-success text-sm font-medium">
              {{ successMessage() }}
            </p>
          </div>
        }

        <!-- Alert Error -->
        @if (errorMessage()) {
          <div
            class="mb-6 bg-red-500/10 border-l-4 border-red-500 p-4 rounded-r-lg text-red-500 text-sm"
          >
            {{ errorMessage() }}
          </div>
        }

        <form
          [formGroup]="forgotForm"
          (ngSubmit)="onSubmit()"
          class="space-y-6"
        >
          <div class="space-y-1">
            <label
              for="email"
              class="text-xs font-semibold text-muted uppercase tracking-wider"
              >Email Corporativo</label
            >
            <div class="relative">
              <input
                type="email"
                id="email"
                formControlName="email"
                class="w-full bg-dark border border-border rounded-md p-2.5 pl-10 text-main focus:border-primary outline-none transition-all"
                placeholder="usuario@empresa.com"
                autocomplete="email"
              />
              <svg
                class="w-5 h-5 text-muted absolute left-3 top-1/2 -translate-y-1/2"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="1.5"
                  d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                ></path>
              </svg>
            </div>
          </div>

          <button
            type="submit"
            [disabled]="forgotForm.invalid || isLoading()"
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
              Procesando...
            } @else {
              <svg
                class="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                ></path>
              </svg>
              ENVIAR ENLACE
            }
          </button>

          <div class="text-center mt-6">
            <a
              routerLink="/auth/login"
              class="text-sm text-muted hover:text-main transition-colors duration-200 flex items-center justify-center gap-1"
            >
              <svg
                class="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M10 19l-7-7m0 0l7-7m-7 7h18"
                ></path>
              </svg>
              Volver al Login
            </a>
          </div>
        </form>
      </div>
    </div>
  `,
})
export class ForgotPasswordComponent {
  private fb = inject(FormBuilder);
  private authService = inject(AuthService);

  forgotForm = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
  });

  isLoading = signal(false);
  successMessage = signal<string | null>(null);
  errorMessage = signal<string | null>(null);

  onSubmit() {
    if (this.forgotForm.valid) {
      this.isLoading.set(true);
      this.errorMessage.set(null);
      this.successMessage.set(null);

      this.authService
        .forgotPassword(this.forgotForm.controls.email.value)
        .subscribe({
          next: (res: any) => {
            this.successMessage.set(res.message);
            this.isLoading.set(false);
            this.forgotForm.reset();
          },
          error: () => {
            this.errorMessage.set(
              'Ha ocurrido un error al procesar tu solicitud.',
            );
            this.isLoading.set(false);
          },
        });
    }
  }
}

