import {
  Component,
  ElementRef,
  output,
  viewChild,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { ProfileService } from '../../../../core/services/profile/profile.service';
import { NotificationService } from '../../../../core/services/notification/notification.service';

@Component({
  selector: 'app-totp-disable-dialog',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './totp-disable-dialog.component.html',
})
export class TotpDisableDialogComponent {
  private fb = inject(FormBuilder);
  private profileApi = inject(ProfileService);
  private notify = inject(NotificationService);

  readonly totpDisabled = output<void>();

  private dialog = viewChild<ElementRef<HTMLDialogElement>>('totpDisableDialog');

  form = this.fb.nonNullable.group({
    password: ['', [Validators.required]],
    totpCode: [
      '',
      [Validators.required, Validators.pattern(/^\d{6}$/)],
    ],
  });
  busy = false;

  open(): void {
    this.form.reset();
    queueMicrotask(() => this.dialog()?.nativeElement?.showModal());
  }

  close(): void {
    this.dialog()?.nativeElement?.close();
  }

  onDialogCancel(ev: Event): void {
    ev.preventDefault();
    this.close();
  }

  onBackdropClick(ev: MouseEvent): void {
    if ((ev.target as HTMLElement).classList?.contains('totp-disable-backdrop')) {
      this.close();
    }
  }

  submit(): void {
    if (this.form.invalid) return;
    this.busy = true;
    const v = this.form.getRawValue();
    this.profileApi
      .disableTotp({ password: v.password!, totpCode: v.totpCode! })
      .subscribe({
        next: (r) => {
          this.notify.success(r.message ?? 'TOTP desactivado');
          this.busy = false;
          this.close();
          this.totpDisabled.emit();
        },
        error: (err) => {
          this.busy = false;
          this.notify.error(
            err.error?.message ?? 'No se pudo desactivar TOTP',
          );
        },
      });
  }
}
