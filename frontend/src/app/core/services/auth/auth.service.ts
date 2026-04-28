import { Injectable, signal, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { environment } from '../../../../environments/environment';
import { tap, finalize } from 'rxjs/operators';
import { NotificationService } from '../notification/notification.service';

/** Respuesta de POST /auth/login: JWT o requisito de segundo factor (Super Admin). */
export type LoginApiResult =
  | {
      access_token: string;
      user: UserPayload & {
        tenant?: { id: string; name: string; logoUrl: string | null };
      };
    }
  | {
      stepUpRequired: true;
      stepUpToken: string;
      message: string;
    }
  | {
      totpRequired: true;
      preAuthToken: string;
      message: string;
    };

export interface UserPayload {
  id: string;
  email: string;
  name: string;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  avatarUrl?: string | null;
  role: 'SUPER_ADMIN' | 'ADMIN' | 'SUPERVISOR' | 'MECHANIC';
  allowedContracts: string[];
  /** ID del rol custom asignado al usuario (si tiene uno). */
  customRoleId?: string | null;
  /** Nombre del rol custom (informativo). */
  customRoleName?: string | null;
}

/** Payload mínimo del JWT de acceso (Nest/jwt exp en segundos). */
interface JwtPayload {
  exp?: number;
  iat?: number;
}

function decodeJwtPayload(token: string): JwtPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    let base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4 !== 0) {
      base64 += '=';
    }
    const json = atob(base64);
    return JSON.parse(json) as JwtPayload;
  } catch {
    return null;
  }
}

/** Margen ante desfase de reloj (segundos). */
const JWT_EXP_SKEW_SEC = 60;

/** `message` del body JSON de Nest (`HttpException`), puede ser string o array (validación). */
export function readNestHttpErrorMessage(err: unknown): string | null {
  const e = err as { error?: { message?: string | string[] } };
  const m = e?.error?.message;
  if (typeof m === 'string' && m.trim()) return m;
  if (Array.isArray(m) && m.length && typeof m[0] === 'string') return m[0];
  return null;
}

export function isAccessTokenExpired(token: string): boolean {
  const payload = decodeJwtPayload(token);
  if (!payload?.exp) return true;
  const now = Math.floor(Date.now() / 1000);
  return now >= payload.exp - JWT_EXP_SKEW_SEC;
}

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private apiUrl = `${environment.apiUrl}/auth`;

  /** Evita varios avisos si varias peticiones devuelven 401 a la vez. */
  private forceLogoutInProgress = false;

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

  getCaptchaChallenge() {
    return this.http.get<{ challengeId: string; question: string }>(
      `${this.apiUrl}/captcha`,
    );
  }

  login(credentials: {
    tenantCode: string;
    email: string;
    password: string;
    challengeId: string;
    challengeAnswer: string;
    honeypot?: string;
  }) {
    return this.http
      .post<LoginApiResult>(`${this.apiUrl}/login`, {
        tenantCode: credentials.tenantCode,
        email: credentials.email,
        password: credentials.password,
        challengeId: credentials.challengeId,
        challengeAnswer: credentials.challengeAnswer,
        honeypot: credentials.honeypot ?? '',
      })
      .pipe(
        tap({
          next: (response) => {
            this.forceLogoutInProgress = false;
            if (
              'totpRequired' in response &&
              response.totpRequired === true
            ) {
              this.notification.info(response.message);
              return;
            }
            if (
              'stepUpRequired' in response &&
              response.stepUpRequired === true
            ) {
              this.notification.info(response.message);
              return;
            }
            if (!('access_token' in response)) {
              return;
            }
            this.setSession(response.access_token, response.user);
            this.notification.success(`Bienvenido ${response.user.name}`);
          },
          error: (err: unknown) => {
            const status = (err as { status?: number }).status;
            if (status === 429) {
              this.notification.error(
                'Demasiados intentos. Espera un momento e inténtalo de nuevo.',
              );
            } else if (status === 423) {
              const msg =
                readNestHttpErrorMessage(err) ??
                'Cuenta bloqueada temporalmente por intentos fallidos.';
              this.notification.error(msg);
            } else if (status === 403) {
              this.notification.error(
                'Tu cuenta está desactivada. Contacta al administrador.',
              );
            } else if (status === 503) {
              const msg =
                readNestHttpErrorMessage(err) ??
                'Servicio de verificación no disponible. Reintenta más tarde.';
              this.notification.error(msg);
            } else if (status === 401) {
              const msg =
                readNestHttpErrorMessage(err) ??
                'Credenciales inválidas o cuenta no activa.';
              this.notification.error(msg);
            } else {
              const msg =
                readNestHttpErrorMessage(err) ??
                'No se pudo iniciar sesión. Reintenta en unos segundos.';
              this.notification.error(msg);
            }
          },
        }),
      );
  }

  verifyTotpLogin(body: { preAuthToken: string; totpCode: string }) {
    return this.http
      .post<LoginApiResult>(`${this.apiUrl}/login/verify-totp`, {
        preAuthToken: body.preAuthToken,
        totpCode: body.totpCode,
      })
      .pipe(
        tap({
          next: (response) => {
            this.forceLogoutInProgress = false;
            if (
              'stepUpRequired' in response &&
              response.stepUpRequired === true
            ) {
              this.notification.info(response.message);
              return;
            }
            if (!('access_token' in response)) {
              return;
            }
            this.setSession(response.access_token, response.user);
            this.notification.success(`Bienvenido ${response.user.name}`);
          },
          error: (err) => {
            if (err.status === 429) {
              this.notification.error(
                'Demasiados intentos. Espera un momento e inténtalo de nuevo.',
              );
            } else if (err.status === 401) {
              const msg =
                typeof err.error?.message === 'string'
                  ? err.error.message
                  : 'Código TOTP incorrecto o sesión de verificación vencida.';
              this.notification.error(msg);
            } else if (err.status === 503) {
              const msg =
                typeof err.error?.message === 'string'
                  ? err.error.message
                  : 'Servicio de verificación no disponible. Reintenta más tarde.';
              this.notification.error(msg);
            } else {
              this.notification.error('No se pudo verificar el código.');
            }
          },
        }),
      );
  }

  verifySuperAdminStepUp(body: { stepUpToken: string; code: string }) {
    return this.http
      .post<{
        access_token: string;
        user: UserPayload & {
          tenant?: { id: string; name: string; logoUrl: string | null };
        };
      }>(`${this.apiUrl}/login/super-admin-step-up`, body)
      .pipe(
        tap({
          next: (response) => {
            this.forceLogoutInProgress = false;
            this.setSession(response.access_token, response.user);
            this.notification.success(`Bienvenido ${response.user.name}`);
          },
          error: (err) => {
            if (err.status === 429) {
              this.notification.error(
                'Demasiados intentos. Espera un momento e inténtalo de nuevo.',
              );
            } else if (err.status === 401) {
              const msg =
                typeof err.error?.message === 'string'
                  ? err.error.message
                  : 'Código incorrecto o sesión de verificación vencida.';
              this.notification.error(msg);
            } else {
              this.notification.error('No se pudo verificar el código.');
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
            this.forceLogoutInProgress = false;
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

  forgotPassword(payload: {
    email: string;
    challengeId: string;
    challengeAnswer: string;
    honeypot?: string;
  }) {
    return this.http.post<{ success: boolean; message: string }>(
      `${this.apiUrl}/forgot-password`,
      {
        email: payload.email,
        challengeId: payload.challengeId,
        challengeAnswer: payload.challengeAnswer,
        honeypot: payload.honeypot ?? '',
      },
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
      const token = localStorage.getItem('tpm_token');
      if (token && !isAccessTokenExpired(token)) {
        this.http
          .post<{ ok: boolean }>(`${this.apiUrl}/audit/logout`, {})
          .pipe(
            finalize(() => {
              this.clearStoredSession();
              this.router.navigate(['/auth/login']);
            }),
          )
          .subscribe();
        return;
      }
    }
    this.clearStoredSession();
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
      if (isAccessTokenExpired(token)) {
        this.clearStoredSession();
        return;
      }
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

  /**
   * Sesión usable para rutas protegidas: token presente, no expirado y usuario en storage.
   */
  hasValidSession(): boolean {
    if (!isPlatformBrowser(this.platformId)) return false;
    const token = localStorage.getItem('tpm_token');
    const user = localStorage.getItem('tpm_user');
    if (!token || !user) return false;
    if (isAccessTokenExpired(token)) return false;
    return true;
  }

  /** Limpia storage y estado sin navegar (p. ej. antes de redirigir desde el guard). */
  clearStoredSession(): void {
    if (isPlatformBrowser(this.platformId)) {
      localStorage.removeItem('tpm_token');
      localStorage.removeItem('tpm_user');
      localStorage.removeItem('tpm_contract_id');
    }
    this.currentUser.set(null);
    this.isAuthenticated.set(false);
    this.currentContractId.set(null);
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
    if (!user) return false;
    // SUPER_ADMIN siempre tiene acceso a cualquier recurso protegido por rol.
    if (user.role === 'SUPER_ADMIN') return true;
    return roles.includes(user.role);
  }

  /**
   * Compras / supervisión: montos completos en facturas y OC.
   * Mecánicos y perfiles operativos ven ítems pero no precios ni totales.
   */
  canSeePurchaseFinancials(): boolean {
    const user = this.currentUser();
    if (!user) return false;
    return (
      user.role === 'SUPER_ADMIN' ||
      user.role === 'ADMIN' ||
      user.role === 'SUPERVISOR'
    );
  }

  forceLogout() {
    if (this.forceLogoutInProgress) return;
    this.forceLogoutInProgress = true;
    this.clearStoredSession();
    this.notification.warning('Sesión expirada o cuenta inactiva.');
    this.router.navigate(['/auth/login']).finally(() => {
      this.forceLogoutInProgress = false;
    });
  }

  /**
   * Fusiona campos de perfil en la sesión local (signal + localStorage) para
   * que nombre/avatar sigan visibles ante micro-cortes de red.
   */
  applyProfilePatch(
    patch: Partial<
      Pick<
        UserPayload,
        | 'name'
        | 'firstName'
        | 'lastName'
        | 'phone'
        | 'avatarUrl'
        | 'customRoleId'
        | 'customRoleName'
      >
    >,
  ): void {
    const cur = this.currentUser();
    if (!cur) return;
    const merged: UserPayload = {
      ...cur,
      ...patch,
    };
    this.currentUser.set(merged);
    if (isPlatformBrowser(this.platformId)) {
      localStorage.setItem('tpm_user', JSON.stringify(merged));
    }
  }
}
