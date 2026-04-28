import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { AuthService } from '../../../core/services/auth/auth.service';

@Component({
  selector: 'app-activate-account',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule],
  templateUrl: './activate-account.component.html',
})
export class ActivateAccountComponent implements OnInit {
  private fb = inject(FormBuilder);
  private authService = inject(AuthService);
  private route = inject(ActivatedRoute);

  readonly logoSrc = 'assets/BaseLogic_Logo.png';
  logoFailed = signal(false);

  activateForm = this.fb.nonNullable.group({
    password: ['', [Validators.required, Validators.minLength(8)]],
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

  onLogoError(): void {
    this.logoFailed.set(true);
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
