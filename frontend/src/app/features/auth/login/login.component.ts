import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { AuthService } from '../../../core/services/auth/auth.service';
import { NotificationService } from '../../../core/services/notification/notification.service';

/** Ventajas reales del producto (panel hero). */
export interface LoginFeatureItem {
  icon: 'fleet' | 'ot' | 'inventory' | 'contracts' | 'security';
  title: string;
  blurb: string;
}

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule],
  templateUrl: './login.component.html',
})
export class LoginComponent implements OnInit {
  private fb = inject(FormBuilder);
  private authService = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private notification = inject(NotificationService);

  private returnUrl = '/app/dashboard';

  /** Icono BaseLogic (500×500 px recomendado en archivo; se escala en UI). */
  readonly logoSrc = 'assets/BaseLogic_Logo.png';

  logoFailed = signal(false);

  showPassword = signal(false);

  featureItems: LoginFeatureItem[] = [
    {
      icon: 'fleet',
      title: 'Maestro de flota y medición',
      blurb:
        'Horómetro o kilometraje, ajustes y trazabilidad por activo y contrato.',
    },
    {
      icon: 'ot',
      title: 'Órdenes de trabajo y kits PM',
      blurb:
        'Correctivo y preventivo, repuestos vinculados al inventario y cierre con kardex.',
    },
    {
      icon: 'inventory',
      title: 'Inventario multibodega',
      blurb:
        'Stock por contrato/subcontrato, valorización y consumo al cerrar OT.',
    },
    {
      icon: 'contracts',
      title: 'Contratos y subcontratos',
      blurb:
        'Segregación operativa: equipos y bodegas alineados a su estructura real.',
    },
    {
      icon: 'security',
      title: 'Multi-tenant y auditoría',
      blurb:
        'Aislamiento por empresa, roles y sesión segura para entornos industriales.',
    },
  ];

  loginForm = this.fb.nonNullable.group({
    tenantCode: ['TPM', [Validators.required]],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(4)]],
    /** Verificación humana (suma); el reto viene del servidor. */
    challengeAnswer: ['', [Validators.required]],
    /** Honeypot: debe quedar vacío (bots suelen rellenarlo). */
    honeypot: [''],
  });

  stepUpForm = this.fb.nonNullable.group({
    code: [
      '',
      [Validators.required, Validators.pattern(/^\d{6}$/)],
    ],
  });

  totpForm = this.fb.nonNullable.group({
    code: [
      '',
      [Validators.required, Validators.pattern(/^\d{6}$/)],
    ],
  });

  isLoading = signal(false);
  captchaQuestion = signal<string>('');
  /** Presente cuando GET /auth/captcha respondió OK. */
  captchaId = signal<string | null>(null);
  /** Flujo 2FA por correo (Super Admin). */
  showStepUp = signal(false);
  stepUpToken = signal<string | null>(null);
  showTotp = signal(false);
  preAuthToken = signal<string | null>(null);

  ngOnInit() {
    if (this.authService.hasValidSession()) {
      this.router.navigateByUrl('/app/dashboard');
      return;
    }

    const raw = this.route.snapshot.queryParamMap.get('returnUrl') ?? '';
    this.returnUrl = raw.startsWith('/') ? raw : '/app/dashboard';
    this.refreshCaptcha();
  }

  refreshCaptcha(): void {
    this.captchaId.set(null);
    this.captchaQuestion.set('');
    this.authService.getCaptchaChallenge().subscribe({
      next: (c) => {
        this.captchaId.set(c.challengeId);
        this.captchaQuestion.set(`${c.question} = ?`);
        this.loginForm.controls.challengeAnswer.setValue('');
      },
      error: () => {
        this.notification.error(
          'No se pudo cargar la verificación. Reintenta en unos segundos.',
        );
      },
    });
  }

  onLogoError(): void {
    this.logoFailed.set(true);
  }

  togglePasswordVisibility(): void {
    this.showPassword.update((v) => !v);
  }

  onSubmit() {
    if (this.showStepUp()) {
      this.submitStepUp();
      return;
    }
    if (this.showTotp()) {
      this.submitTotp();
      return;
    }
    const id = this.captchaId();
    if (this.loginForm.valid && id) {
      this.isLoading.set(true);
      const raw = this.loginForm.getRawValue();

      this.authService
        .login({
          tenantCode: raw.tenantCode,
          email: raw.email,
          password: raw.password,
          challengeId: id,
          challengeAnswer: raw.challengeAnswer,
          honeypot: raw.honeypot,
        })
        .subscribe({
          next: (res) => {
            this.isLoading.set(false);
            if (
              res &&
              'totpRequired' in res &&
              res.totpRequired === true
            ) {
              this.preAuthToken.set(res.preAuthToken);
              this.showTotp.set(true);
              this.totpForm.reset({ code: '' });
              return;
            }
            if (
              res &&
              'stepUpRequired' in res &&
              res.stepUpRequired === true
            ) {
              this.stepUpToken.set(res.stepUpToken);
              this.showStepUp.set(true);
              this.stepUpForm.reset({ code: '' });
              return;
            }
            this.router.navigateByUrl(this.returnUrl);
          },
          error: () => {
            this.isLoading.set(false);
            this.refreshCaptcha();
          },
        });
    }
  }

  submitStepUp() {
    const t = this.stepUpToken();
    if (!this.stepUpForm.valid || !t) {
      return;
    }
    this.isLoading.set(true);
    const code = this.stepUpForm.getRawValue().code;
    this.authService
      .verifySuperAdminStepUp({
        stepUpToken: t,
        code,
        tenantCode: this.loginForm.getRawValue().tenantCode,
      })
      .subscribe({
        next: () => {
          this.isLoading.set(false);
          this.router.navigateByUrl(this.returnUrl);
        },
        error: () => {
          this.isLoading.set(false);
        },
      });
  }

  submitTotp() {
    const t = this.preAuthToken();
    if (!this.totpForm.valid || !t) {
      return;
    }
    this.isLoading.set(true);
    const code = this.totpForm.getRawValue().code;
    this.authService
      .verifyTotpLogin({ preAuthToken: t, totpCode: code })
      .subscribe({
        next: (res) => {
          this.isLoading.set(false);
          if (
            res &&
            'stepUpRequired' in res &&
            res.stepUpRequired === true
          ) {
            this.stepUpToken.set(res.stepUpToken);
            this.showTotp.set(false);
            this.preAuthToken.set(null);
            this.showStepUp.set(true);
            this.stepUpForm.reset({ code: '' });
            return;
          }
          this.router.navigateByUrl(this.returnUrl);
        },
        error: () => {
          this.isLoading.set(false);
        },
      });
  }

  backToPasswordStep(): void {
    this.showStepUp.set(false);
    this.showTotp.set(false);
    this.stepUpToken.set(null);
    this.preAuthToken.set(null);
    this.stepUpForm.reset({ code: '' });
    this.totpForm.reset({ code: '' });
  }
}
