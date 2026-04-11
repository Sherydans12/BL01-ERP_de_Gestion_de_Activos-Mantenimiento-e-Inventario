import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthService } from '../../../core/services/auth/auth.service';
import { NotificationService } from '../../../core/services/notification/notification.service';

@Component({
  selector: 'app-forgot-password',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule],
  templateUrl: './forgot-password.component.html',
})
export class ForgotPasswordComponent implements OnInit {
  private fb = inject(FormBuilder);
  private authService = inject(AuthService);
  private notification = inject(NotificationService);

  forgotForm = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    challengeAnswer: ['', [Validators.required]],
    honeypot: [''],
  });

  isLoading = signal(false);
  successMessage = signal<string | null>(null);
  errorMessage = signal<string | null>(null);
  captchaQuestion = signal<string>('');
  captchaId = signal<string | null>(null);

  ngOnInit(): void {
    this.refreshCaptcha();
  }

  refreshCaptcha(): void {
    this.captchaId.set(null);
    this.captchaQuestion.set('');
    this.authService.getCaptchaChallenge().subscribe({
      next: (c) => {
        this.captchaId.set(c.challengeId);
        this.captchaQuestion.set(`${c.question} = ?`);
        this.forgotForm.controls.challengeAnswer.setValue('');
      },
      error: () => {
        this.notification.error(
          'No se pudo cargar la verificación. Reintenta en unos segundos.',
        );
      },
    });
  }

  onSubmit() {
    const id = this.captchaId();
    if (this.forgotForm.valid && id) {
      this.isLoading.set(true);
      this.errorMessage.set(null);
      this.successMessage.set(null);

      const raw = this.forgotForm.getRawValue();

      this.authService
        .forgotPassword({
          email: raw.email,
          challengeId: id,
          challengeAnswer: raw.challengeAnswer,
          honeypot: raw.honeypot,
        })
        .subscribe({
          next: (res: { message?: string }) => {
            this.successMessage.set(res.message ?? 'Revisa tu correo.');
            this.isLoading.set(false);
            this.forgotForm.reset();
            this.refreshCaptcha();
          },
          error: (err: { status?: number }) => {
            if (err.status === 429) {
              this.errorMessage.set(
                'Demasiados intentos. Espera un momento e inténtalo de nuevo.',
              );
            } else {
              this.errorMessage.set(
                'Ha ocurrido un error al procesar tu solicitud.',
              );
            }
            this.isLoading.set(false);
            this.refreshCaptcha();
          },
        });
    }
  }
}
