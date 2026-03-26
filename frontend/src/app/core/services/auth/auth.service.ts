import { Injectable, signal, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { environment } from '../../../../environments/environment';
import { tap } from 'rxjs/operators';
import { NotificationService } from '../notification/notification.service';

export interface UserPayload {
  id: string;
  email: string;
  name: string;
  role: 'ADMIN' | 'SUPERVISOR' | 'MECHANIC';
  allowedContracts: string[]; // Modificado
}

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private apiUrl = `${environment.apiUrl}/auth`;

  // Signals for reactive state
  currentUser = signal<UserPayload | null>(null);
  isAuthenticated = signal<boolean>(false);
  currentContractId = signal<string | null>(null); // Modificado

  constructor(
    private http: HttpClient,
    private router: Router,
    private notification: NotificationService,
    @Inject(PLATFORM_ID) private platformId: Object,
  ) {
    if (isPlatformBrowser(this.platformId)) {
      this.checkToken();
    }
  }

  login(credentials: { tenantCode: string; email: string; password: string }) {
    return this.http
      .post<{
        access_token: string;
        user: UserPayload & {
          tenant?: { id: string; name: string; logoUrl: string };
        };
      }>(`${this.apiUrl}/login`, credentials)
      .pipe(
        tap({
          next: (response) => {
            this.setSession(response.access_token, response.user);
            this.router.navigate(['/']);
            this.notification.success(`Bienvenido ${response.user.name}`);
          },
          error: (err) => {
            if (err.status === 403) {
              this.notification.error(
                'Tu cuenta está desactivada. Contacta al administrador.',
              );
            } else {
              this.notification.error('Credenciales inválidas.');
            }
          },
        }),
      );
  }

  activateAccount(payload: { token: string; password: string }) {
    return this.http
      .post<{
        access_token: string;
        user: UserPayload;
      }>(`${this.apiUrl}/activate`, payload)
      .pipe(
        tap({
          next: (response) => {
            this.setSession(response.access_token, response.user);
            this.router.navigate(['/']);
            this.notification.success(
              'Tu cuenta ha sido activada exitosamente.',
            );
          },
          error: (err) => {
            this.notification.error('El enlace es inválido o ha expirado.');
          },
        }),
      );
  }

  forgotPassword(email: string) {
    return this.http.post<{ success: boolean; message: string }>(
      `${this.apiUrl}/forgot-password`,
      { email },
    );
  }

  resetPassword(token: string, password: string) {
    return this.http.post<{ success: boolean; message: string }>(
      `${this.apiUrl}/reset-password`,
      { token, password },
    );
  }

  logout() {
    if (isPlatformBrowser(this.platformId)) {
      localStorage.removeItem('tpm_token');
      localStorage.removeItem('tpm_user');
      localStorage.removeItem('tpm_contract_id'); // Modificado
    }
    this.currentUser.set(null);
    this.isAuthenticated.set(false);
    this.currentContractId.set(null); // Modificado
    this.router.navigate(['/auth/login']);
  }

  private setSession(token: string, user: UserPayload) {
    let initialContract = 'ALL';

    if (isPlatformBrowser(this.platformId)) {
      localStorage.setItem('tpm_token', token);
      if (user.role === 'ADMIN' && !user.allowedContracts?.includes('ALL')) {
        user.allowedContracts = ['ALL', ...(user.allowedContracts || [])];
      }
      localStorage.setItem('tpm_user', JSON.stringify(user));

      const savedContract = localStorage.getItem('tpm_contract_id');
      if (
        savedContract &&
        (user.allowedContracts?.includes(savedContract) ||
          user.allowedContracts?.includes('ALL'))
      ) {
        initialContract = savedContract;
      } else if (
        user.role !== 'ADMIN' &&
        user.allowedContracts?.length > 0 &&
        !user.allowedContracts.includes('ALL')
      ) {
        initialContract = user.allowedContracts[0];
      }

      localStorage.setItem('tpm_contract_id', initialContract); // Modificado
    } else {
      if (
        user.role !== 'ADMIN' &&
        user.allowedContracts?.length > 0 &&
        !user.allowedContracts.includes('ALL')
      ) {
        initialContract = user.allowedContracts[0];
      }
    }

    this.currentContractId.set(initialContract); // Modificado
    this.currentUser.set(user);
    this.isAuthenticated.set(true);
  }

  private checkToken() {
    const token = localStorage.getItem('tpm_token');
    const user = localStorage.getItem('tpm_user');

    if (token && user) {
      try {
        const parsedUser = JSON.parse(user);
        this.currentUser.set(parsedUser);
        this.isAuthenticated.set(true);

        const contractId = localStorage.getItem('tpm_contract_id'); // Modificado
        if (contractId) {
          this.currentContractId.set(contractId); // Modificado
        } else {
          if (
            parsedUser.role !== 'ADMIN' &&
            parsedUser.allowedContracts?.length > 0 &&
            !parsedUser.allowedContracts.includes('ALL')
          ) {
            this.currentContractId.set(parsedUser.allowedContracts[0]); // Modificado
          } else {
            this.currentContractId.set('ALL'); // Modificado
          }
        }

        // Fix up ADMIN missing ALL in memory
        if (
          parsedUser.role === 'ADMIN' &&
          !parsedUser.allowedContracts?.includes('ALL')
        ) {
          parsedUser.allowedContracts = [
            'ALL',
            ...(parsedUser.allowedContracts || []),
          ];
          this.currentUser.set({ ...parsedUser });
        }
      } catch (e) {
        this.logout();
      }
    } else {
      this.isAuthenticated.set(false);
      this.currentUser.set(null);
      this.currentContractId.set(null); // Modificado
    }
  }

  setCurrentContract(contractId: string) {
    // Modificado
    this.currentContractId.set(contractId); // Modificado
    if (isPlatformBrowser(this.platformId)) {
      localStorage.setItem('tpm_contract_id', contractId); // Modificado
    }
  }

  getToken(): string | null {
    if (isPlatformBrowser(this.platformId)) {
      return localStorage.getItem('tpm_token');
    }
    return null;
  }

  hasRole(roles: string[]): boolean {
    const user = this.currentUser();
    return user ? roles.includes(user.role) : false;
  }

  forceLogout() {
    this.logout();
    this.notification.warning('Sesión expirada o cuenta inactiva.');
  }
}
