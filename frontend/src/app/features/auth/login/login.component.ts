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

  isLoading = signal(false);
  captchaQuestion = signal<string>('');
  /** Presente cuando GET /auth/captcha respondió OK. */
  captchaId = signal<string | null>(null);

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
          next: () => {
            this.isLoading.set(false);
            this.router.navigateByUrl(this.returnUrl);
          },
          error: () => {
            this.isLoading.set(false);
            this.refreshCaptcha();
          },
        });
    }
  }
}
