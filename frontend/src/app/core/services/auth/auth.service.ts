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
  allowedSites: string[];
}

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private apiUrl = `${environment.apiUrl}/auth`;

  // Signals for reactive state
  currentUser = signal<UserPayload | null>(null);
  isAuthenticated = signal<boolean>(false);
  currentSiteId = signal<string | null>(null);

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
            // Mejora: Diferenciar si es error de credenciales o de cuenta inactiva
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
      localStorage.removeItem('tpm_site_id');
    }
    this.currentUser.set(null);
    this.isAuthenticated.set(false);
    this.currentSiteId.set(null);
    this.router.navigate(['/auth/login']);
  }

  private setSession(token: string, user: UserPayload) {
    let initialSite = 'ALL';

    if (isPlatformBrowser(this.platformId)) {
      localStorage.setItem('tpm_token', token);
      if (user.role === 'ADMIN' && !user.allowedSites?.includes('ALL')) {
        user.allowedSites = ['ALL', ...(user.allowedSites || [])];
      }
      localStorage.setItem('tpm_user', JSON.stringify(user));

      const savedSite = localStorage.getItem('tpm_site_id');
      if (
        savedSite &&
        (user.allowedSites?.includes(savedSite) ||
          user.allowedSites?.includes('ALL'))
      ) {
        initialSite = savedSite;
      } else if (
        user.role !== 'ADMIN' &&
        user.allowedSites?.length > 0 &&
        !user.allowedSites.includes('ALL')
      ) {
        initialSite = user.allowedSites[0];
      }

      localStorage.setItem('tpm_site_id', initialSite);
    } else {
      if (
        user.role !== 'ADMIN' &&
        user.allowedSites?.length > 0 &&
        !user.allowedSites.includes('ALL')
      ) {
        initialSite = user.allowedSites[0];
      }
    }

    this.currentSiteId.set(initialSite);
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

        const siteId = localStorage.getItem('tpm_site_id');
        if (siteId) {
          this.currentSiteId.set(siteId);
        } else {
          if (
            parsedUser.role !== 'ADMIN' &&
            parsedUser.allowedSites?.length > 0 &&
            !parsedUser.allowedSites.includes('ALL')
          ) {
            this.currentSiteId.set(parsedUser.allowedSites[0]);
          } else {
            this.currentSiteId.set('ALL');
          }
        }

        // Fix up ADMIN missing ALL in memory
        if (
          parsedUser.role === 'ADMIN' &&
          !parsedUser.allowedSites?.includes('ALL')
        ) {
          parsedUser.allowedSites = ['ALL', ...(parsedUser.allowedSites || [])];
          this.currentUser.set({ ...parsedUser });
        }
      } catch (e) {
        this.logout();
      }
    } else {
      this.isAuthenticated.set(false);
      this.currentUser.set(null);
      this.currentSiteId.set(null);
    }
  }

  setCurrentSite(siteId: string) {
    this.currentSiteId.set(siteId);
    if (isPlatformBrowser(this.platformId)) {
      localStorage.setItem('tpm_site_id', siteId);
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
