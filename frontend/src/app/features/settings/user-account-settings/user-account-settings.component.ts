import {
  Component,
  inject,
  OnInit,
  signal,
  ElementRef,
  viewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators,
  AbstractControl,
  ValidationErrors,
} from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  ProfileService,
  ProfileMeDto,
  LoginActivityRow,
  ActiveSessionRow,
} from '../../../core/services/profile/profile.service';
import { AuthService } from '../../../core/services/auth/auth.service';
import { NotificationService } from '../../../core/services/notification/notification.service';
import { AvatarComponent } from '../../../shared/components/avatar/avatar.component';
import { ROLE_LABELS } from '../../../core/navigation/nav.config';

function passwordPolicyValidator(control: AbstractControl): ValidationErrors | null {
  const v = (control.value as string) || '';
  if (!v.length) return null;
  const okLen = v.length >= 8;
  const okLetter = /[A-Za-zÁÉÍÓÚÜáéíóúüÑñ]/.test(v);
  const okNum = /[0-9]/.test(v);
  if (okLen && okLetter && okNum) return null;
  return { passwordPolicy: true };
}

function passwordMatchValidator(group: AbstractControl): ValidationErrors | null {
  const n = group.get('newPassword')?.value as string | undefined;
  const c = group.get('confirmPassword')?.value as string | undefined;
  if (n && c && n !== c) return { passwordMismatch: true };
  return null;
}

@Component({
  selector: 'app-user-account-settings',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink, AvatarComponent],
  templateUrl: './user-account-settings.component.html',
})
export class UserAccountSettingsComponent implements OnInit {
  private fb = inject(FormBuilder);
  private profileApi = inject(ProfileService);
  private auth = inject(AuthService);
  private notify = inject(NotificationService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  datosAnchor = viewChild<ElementRef<HTMLElement>>('datosAnchor');
  seguridadAnchor = viewChild<ElementRef<HTMLElement>>('seguridadAnchor');

  loading = signal(true);
  savingPersonal = signal(false);
  uploadingAvatar = signal(false);
  savingPassword = signal(false);
  me = signal<ProfileMeDto | null>(null);
  loginActivity = signal<LoginActivityRow[]>([]);
  loginActivityLoading = signal(false);
  sessions = signal<ActiveSessionRow[]>([]);
  sessionsLoading = signal(false);
  revokingSessionId = signal<string | null>(null);
  revokingOthers = signal(false);

  personalForm = this.fb.group({
    firstName: ['', [Validators.maxLength(100)]],
    lastName: ['', [Validators.maxLength(100)]],
    phone: ['', [Validators.maxLength(20)]],
  });

  passwordForm = this.fb.group(
    {
      oldPassword: ['', [Validators.required]],
      newPassword: [
        '',
        [Validators.required, Validators.minLength(8), passwordPolicyValidator],
      ],
      confirmPassword: ['', [Validators.required]],
    },
    { validators: passwordMatchValidator },
  );

  readonly roleLabels = ROLE_LABELS;

  ngOnInit() {
    this.route.fragment.subscribe((frag) => {
      if (frag) {
        queueMicrotask(() => this.scrollToFragment(frag));
      }
    });
    this.reloadProfile();
    this.loadLoginActivity();
    this.loadSessions();
  }

  loadSessions() {
    this.sessionsLoading.set(true);
    this.profileApi.getActiveSessions().subscribe({
      next: (rows) => {
        this.sessions.set(rows);
        this.sessionsLoading.set(false);
      },
      error: () => {
        this.sessions.set([]);
        this.sessionsLoading.set(false);
      },
    });
  }

  revokeSessionRow(row: ActiveSessionRow) {
    this.revokingSessionId.set(row.id);
    this.profileApi.revokeSession(row.id).subscribe({
      next: () => {
        this.notify.success(
          row.isCurrent
            ? 'Sesión cerrada en este dispositivo.'
            : 'Sesión revocada.',
        );
        this.revokingSessionId.set(null);
        if (row.isCurrent) {
          this.auth.clearStoredSession();
          void this.router.navigate(['/auth/login'], {
            queryParams: { returnUrl: '/app/configuracion#seguridad' },
          });
        } else {
          this.loadSessions();
        }
      },
      error: (err) => {
        const msg = err.error?.message ?? 'No se pudo cerrar la sesión';
        this.notify.error(msg);
        this.revokingSessionId.set(null);
      },
    });
  }

  revokeAllOtherSessions() {
    this.revokingOthers.set(true);
    this.profileApi.revokeOtherSessions().subscribe({
      next: (res) => {
        this.notify.success(
          res.revoked > 0
            ? `Se cerraron ${res.revoked} sesión(es) en otros dispositivos.`
            : 'No había otras sesiones activas.',
        );
        this.revokingOthers.set(false);
        this.loadSessions();
      },
      error: (err) => {
        const msg = err.error?.message ?? 'No se pudo revocar sesiones';
        this.notify.error(msg);
        this.revokingOthers.set(false);
      },
    });
  }

  loadLoginActivity() {
    this.loginActivityLoading.set(true);
    this.profileApi.getLoginActivity().subscribe({
      next: (rows) => {
        this.loginActivity.set(rows);
        this.loginActivityLoading.set(false);
      },
      error: () => {
        this.loginActivity.set([]);
        this.loginActivityLoading.set(false);
      },
    });
  }

  private scrollToFragment(frag: string) {
    const id = frag === 'seguridad' ? 'seguridad' : 'datos';
    const ref =
      id === 'seguridad' ? this.seguridadAnchor() : this.datosAnchor();
    ref?.nativeElement?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  reloadProfile() {
    this.loading.set(true);
    this.profileApi.getMe().subscribe({
      next: (dto) => {
        this.me.set(dto);
        this.personalForm.patchValue({
          firstName: dto.firstName ?? '',
          lastName: dto.lastName ?? '',
          phone: dto.phone ?? '',
        });
        this.auth.applyProfilePatch({
          name: dto.name,
          firstName: dto.firstName,
          lastName: dto.lastName,
          phone: dto.phone,
          avatarUrl: dto.avatarUrl,
          customRoleId: dto.customRoleId,
          customRoleName: dto.customRoleName,
        });
        this.loading.set(false);
        const frag = this.route.snapshot.fragment;
        if (frag) {
          setTimeout(() => this.scrollToFragment(frag), 0);
        }
      },
      error: () => {
        this.notify.error('No se pudo cargar el perfil');
        this.loading.set(false);
      },
    });
  }

  roleLabel(): string {
    const r = this.me()?.role;
    if (!r) return '';
    return this.roleLabels[r as keyof typeof ROLE_LABELS] ?? r;
  }

  onPickAvatar(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.uploadingAvatar.set(true);
    this.profileApi.uploadAvatar(file).subscribe({
      next: (dto) => {
        this.me.set(dto);
        this.auth.applyProfilePatch({ avatarUrl: dto.avatarUrl });
        this.notify.success('Foto de perfil actualizada');
        this.uploadingAvatar.set(false);
      },
      error: (err) => {
        const msg = err.error?.message ?? 'No se pudo subir la imagen';
        this.notify.error(msg);
        this.uploadingAvatar.set(false);
      },
    });
  }

  removeAvatar() {
    this.savingPersonal.set(true);
    this.profileApi.updateProfile({ removeAvatar: true }).subscribe({
      next: (dto) => {
        this.me.set(dto);
        this.auth.applyProfilePatch({ avatarUrl: dto.avatarUrl });
        this.notify.success('Foto eliminada');
        this.savingPersonal.set(false);
      },
      error: () => {
        this.notify.error('No se pudo eliminar la foto');
        this.savingPersonal.set(false);
      },
    });
  }

  savePersonal() {
    if (this.personalForm.invalid) return;
    this.savingPersonal.set(true);
    const v = this.personalForm.getRawValue();
    this.profileApi
      .updateProfile({
        firstName: v.firstName?.trim() ?? '',
        lastName: v.lastName?.trim() ?? '',
        phone: v.phone?.trim() || null,
      })
      .subscribe({
        next: (dto) => {
          this.me.set(dto);
          this.auth.applyProfilePatch({
            name: dto.name,
            firstName: dto.firstName,
            lastName: dto.lastName,
            phone: dto.phone,
          });
          this.notify.success('Datos guardados');
          this.savingPersonal.set(false);
        },
        error: (err) => {
          const msg = err.error?.message ?? 'No se pudo guardar';
          this.notify.error(msg);
          this.savingPersonal.set(false);
        },
      });
  }

  savePassword() {
    if (this.passwordForm.invalid) return;
    const { oldPassword, newPassword } = this.passwordForm.getRawValue();
    this.savingPassword.set(true);
    this.profileApi.changePassword(oldPassword!, newPassword!).subscribe({
      next: (res) => {
        this.notify.success(
          (res.message ?? 'Contraseña actualizada') +
            ' Debe iniciar sesión de nuevo en todos los dispositivos.',
        );
        this.passwordForm.reset();
        this.savingPassword.set(false);
        this.auth.clearStoredSession();
        void this.router.navigate(['/auth/login'], {
          queryParams: { returnUrl: '/app/configuracion#seguridad' },
        });
      },
      error: (err) => {
        const msg =
          err.error?.message ??
          (err.status === 401
            ? 'La contraseña actual no es correcta'
            : 'No se pudo cambiar la contraseña');
        this.notify.error(msg);
        this.savingPassword.set(false);
      },
    });
  }

  passwordHasMinLen(): boolean {
    const v = this.passwordForm.get('newPassword')?.value as string | undefined;
    return !!v && v.length >= 8;
  }

  passwordHasLetter(): boolean {
    const v = this.passwordForm.get('newPassword')?.value as string | undefined;
    return !!v && /[A-Za-zÁÉÍÓÚÜáéíóúüÑñ]/.test(v);
  }

  passwordHasNumber(): boolean {
    const v = this.passwordForm.get('newPassword')?.value as string | undefined;
    return !!v && /[0-9]/.test(v);
  }

  passwordHasSymbol(): boolean {
    const v = this.passwordForm.get('newPassword')?.value as string | undefined;
    return !!v && /[^A-Za-zÁÉÍÓÚÜáéíóúüÑñ0-9\s]/.test(v);
  }

  passwordHasUpper(): boolean {
    const v = this.passwordForm.get('newPassword')?.value as string | undefined;
    return !!v && /[A-ZÁÉÍÓÚÜÑ]/.test(v);
  }
}
