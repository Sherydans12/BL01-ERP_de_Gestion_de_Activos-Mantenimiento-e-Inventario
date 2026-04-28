import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../../environments/environment';

export interface LoginActivityRow {
  id: string;
  createdAt: string;
  city: string;
  country: string;
  ipAddress: string;
  userAgent: string;
  isSuspicious: boolean;
  deviceLabel: string;
  unusualLocationOrIp: boolean;
}

export interface ActiveSessionRow {
  id: string;
  jti: string;
  deviceLabel: string;
  ipAddress: string;
  lastActiveAt: string;
  createdAt: string;
  isCurrent: boolean;
}

export interface ProfileSecurityFlagsDto {
  /** Valor en BD (módulo Seguridad global). */
  platformEmailStepUpEnabled: boolean;
  /** `AUTH_STEP_UP_BYPASS=true` en el servidor: no se exige 2FA aunque la política esté on. */
  localDevelopmentBypass: boolean;
  /** Política + rol: si aplica 2FA por correo en logins poco habituales. */
  emailStepUpAppliesToThisUser: boolean;
}

export interface ProfileMeDto {
  id: string;
  email: string;
  name: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  avatarUrl: string | null;
  role: string;
  customRoleId: string | null;
  customRoleName: string | null;
  /** Correo ante login con IP o país distinto al anterior. */
  notifyUnusualLogin: boolean;
  /** Política de plataforma y alcance para el rol actual. */
  security?: ProfileSecurityFlagsDto;
}

@Injectable({
  providedIn: 'root',
})
export class ProfileService {
  private http = inject(HttpClient);
  private base = `${environment.apiUrl}/users`;
  private authBase = `${environment.apiUrl}/auth`;

  getMe() {
    return this.http.get<ProfileMeDto>(`${this.base}/me`);
  }

  getLoginActivity() {
    return this.http.get<LoginActivityRow[]>(`${this.base}/me/login-activity`);
  }

  updateProfile(body: {
    firstName?: string;
    lastName?: string;
    phone?: string | null;
    removeAvatar?: boolean;
    notifyUnusualLogin?: boolean;
  }) {
    return this.http.put<ProfileMeDto>(`${this.base}/profile`, body);
  }

  uploadAvatar(file: File) {
    const fd = new FormData();
    fd.append('file', file);
    return this.http.post<ProfileMeDto>(`${this.base}/profile/avatar`, fd);
  }

  changePassword(oldPassword: string, newPassword: string) {
    return this.http.post<{ success: boolean; message: string }>(
      `${this.base}/change-password`,
      { oldPassword, newPassword },
    );
  }

  getActiveSessions() {
    return this.http.get<ActiveSessionRow[]>(`${this.authBase}/sessions`);
  }

  revokeSession(sessionId: string) {
    return this.http.delete<{ ok: boolean }>(`${this.authBase}/sessions/${sessionId}`);
  }

  revokeOtherSessions() {
    return this.http.post<{ revoked: number }>(
      `${this.authBase}/sessions/revoke-others`,
      {},
    );
  }
}
