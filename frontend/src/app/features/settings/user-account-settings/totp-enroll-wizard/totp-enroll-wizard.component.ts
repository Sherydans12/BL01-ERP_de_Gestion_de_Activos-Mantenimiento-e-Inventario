import {
  Component,
  ElementRef,
  output,
  signal,
  viewChild,
  inject,
  computed,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { ProfileService } from '../../../../core/services/profile/profile.service';
import { NotificationService } from '../../../../core/services/notification/notification.service';

type WizardStep = 1 | 2 | 3;

@Component({
  selector: 'app-totp-enroll-wizard',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './totp-enroll-wizard.component.html',
})
export class TotpEnrollWizardComponent {
  private fb = inject(FormBuilder);
  private profileApi = inject(ProfileService);
  private notify = inject(NotificationService);

  /** Tras activar TOTP con éxito. */
  readonly totpActivated = output<void>();

  private dialog = viewChild<ElementRef<HTMLDialogElement>>('totpEnrollDialog');

  step = signal<WizardStep>(1);
  busy = signal(false);
  otpauthUrl = signal<string | null>(null);
  manualKey = signal<string | null>(null);

  form = this.fb.nonNullable.group({
    code: [
      '',
      [Validators.required, Validators.pattern(/^\d{6}$/)],
    ],
  });

  qrDataUrl = computed(() => {
    const u = this.otpauthUrl();
    if (!u) return null;
    return `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(u)}`;
  });

  open(): void {
    this.step.set(1);
    this.otpauthUrl.set(null);
    this.manualKey.set(null);
    this.form.reset({ code: '' });
    queueMicrotask(() => {
      this.dialog()?.nativeElement?.showModal();
    });
  }

  close(): void {
    this.dialog()?.nativeElement?.close();
  }

  onDialogCancel(ev: Event): void {
    ev.preventDefault();
    this.close();
  }

  onBackdropClick(ev: MouseEvent): void {
    if ((ev.target as HTMLElement).classList?.contains('totp-enroll-backdrop')) {
      this.close();
    }
  }

  /** Paso 1 → 2: obtiene secreto y QR en servidor. */
  startEnrollment(): void {
    this.busy.set(true);
    this.profileApi.beginTotp().subscribe({
      next: (r) => {
        this.otpauthUrl.set(r.otpauthUrl);
        this.manualKey.set(r.manualKey);
        this.step.set(2);
        this.busy.set(false);
      },
      error: (err) => {
        this.busy.set(false);
        this.notify.error(
          err.error?.message ?? 'No se pudo preparar el registro TOTP',
        );
      },
    });
  }

  goToVerifyStep(): void {
    this.step.set(3);
    this.form.reset({ code: '' });
  }

  backToScan(): void {
    this.step.set(2);
  }

  submitActivate(): void {
    if (this.form.invalid) return;
    this.busy.set(true);
    const code = this.form.getRawValue().code;
    this.profileApi.activateTotp(code).subscribe({
      next: (r) => {
        this.notify.success(r.message ?? 'TOTP activado');
        this.busy.set(false);
        this.close();
        this.totpActivated.emit();
      },
      error: (err) => {
        this.busy.set(false);
        this.notify.error(err.error?.message ?? 'Código no válido');
      },
    });
  }
}
