import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { forkJoin } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { NotificationService } from '../../../core/services/notification/notification.service';
import { AuthService } from '../../../core/services/auth/auth.service';

export interface SecurityDashboardStats {
  onlineUsersCount: number;
  activeSessionsCount: number;
  suspiciousAlerts24h: number;
  loginFailures24h: number;
}

export interface SuspiciousAuthLogRow {
  id: string;
  userId: string | null;
  emailAttempted: string;
  action: string;
  ipAddress: string;
  userAgent: string;
  city: string;
  country: string;
  isSuspicious: boolean;
  createdAt: string;
  user: {
    id: string;
    email: string;
    name: string;
    firstName: string | null;
    lastName: string | null;
    tenantId: string | null;
  } | null;
}

export interface TenantActiveSessionRow {
  id: string;
  userId: string;
  jti: string;
  deviceLabel: string;
  ipAddress: string;
  lastActiveAt: string;
  createdAt: string;
  user: {
    id: string;
    email: string;
    name: string;
    firstName: string | null;
    lastName: string | null;
    tenantId: string | null;
  };
}

export type SecurityTabId = 'alerts' | 'sessions' | 'policies';

export interface GlobalAuthSettings {
  superAdminStepUpEmailEnabled: boolean;
  /** true si `AUTH_STEP_UP_BYPASS=true` en el backend (p. ej. local). */
  authStepUpLocalBypass: boolean;
}

@Component({
  selector: 'app-admin-security',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './admin-security.component.html',
})
export class AdminSecurityComponent implements OnInit {
  private http = inject(HttpClient);
  private notify = inject(NotificationService);
  private auth = inject(AuthService);

  private readonly base = `${environment.apiUrl}/admin/security`;

  loading = signal(true);
  tab = signal<SecurityTabId>('alerts');
  stats = signal<SecurityDashboardStats | null>(null);
  suspiciousRows = signal<SuspiciousAuthLogRow[]>([]);
  sessionRows = signal<TenantActiveSessionRow[]>([]);
  revokingId = signal<string | null>(null);
  globalAuth = signal<GlobalAuthSettings | null>(null);
  savingGlobalAuth = signal(false);

  isSuperAdmin = computed(
    () => this.auth.currentUser()?.role === 'SUPER_ADMIN',
  );

  ngOnInit() {
    this.reload();
  }

  reload() {
    this.loading.set(true);
    forkJoin({
      stats: this.http.get<SecurityDashboardStats>(`${this.base}/dashboard-stats`),
      suspicious: this.http.get<SuspiciousAuthLogRow[]>(`${this.base}/suspicious-auth`),
      sessions: this.http.get<TenantActiveSessionRow[]>(`${this.base}/active-sessions`),
      globalAuth: this.http.get<GlobalAuthSettings>(`${this.base}/global-auth-settings`),
    }).subscribe({
      next: ({ stats, suspicious, sessions, globalAuth }) => {
        this.stats.set(stats);
        this.suspiciousRows.set(suspicious);
        this.sessionRows.set(sessions);
        this.globalAuth.set(globalAuth);
        this.loading.set(false);
      },
      error: () => {
        this.notify.error('No se pudo cargar el módulo de seguridad');
        this.stats.set(null);
        this.suspiciousRows.set([]);
        this.sessionRows.set([]);
        this.globalAuth.set(null);
        this.loading.set(false);
      },
    });
  }

  setTab(id: SecurityTabId) {
    this.tab.set(id);
  }

  displayUserName(u: {
    firstName: string | null;
    lastName: string | null;
    name: string;
  }): string {
    const parts = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
    return parts || u.name;
  }

  revokeTenantSession(row: TenantActiveSessionRow) {
    this.revokingId.set(row.id);
    this.http.delete<{ ok: boolean }>(`${this.base}/sessions/${row.id}`).subscribe({
      next: () => {
        this.notify.success('Sesión revocada');
        this.revokingId.set(null);
        this.reload();
      },
      error: (err) => {
        const msg = err.error?.message ?? 'No se pudo revocar la sesión';
        this.notify.error(msg);
        this.revokingId.set(null);
      },
    });
  }

  actionLabel(action: string): string {
    switch (action) {
      case 'LOGIN_SUCCESS':
        return 'Login OK';
      case 'LOGIN_FAILURE':
        return 'Login fallido';
      case 'PASSWORD_CHANGE':
        return 'Cambio de clave';
      case 'LOGOUT':
        return 'Logout';
      default:
        return action;
    }
  }

  onToggleSuperAdminStepUp(event: Event) {
    if (!this.isSuperAdmin()) return;
    const checked = (event.target as HTMLInputElement).checked;
    this.savingGlobalAuth.set(true);
    this.http
      .patch<GlobalAuthSettings>(`${this.base}/global-auth-settings`, {
        superAdminStepUpEmailEnabled: checked,
      })
      .subscribe({
        next: (r) => {
          this.globalAuth.set(r);
          this.savingGlobalAuth.set(false);
          this.notify.success('Política de autenticación actualizada');
        },
        error: (err) => {
          this.savingGlobalAuth.set(false);
          const msg = err.error?.message ?? 'No se pudo guardar la política';
          this.notify.error(msg);
          this.reload();
        },
      });
  }
}
