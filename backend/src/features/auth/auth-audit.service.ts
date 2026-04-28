import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthAuditAction } from '@prisma/client';
import { USER_ROLES_WITH_EMAIL_STEP_UP } from './step-up-policy.service';

export type GeoLookupResult = { city: string; country: string };

const GEO_TIMEOUT_MS = 2800;
const FAILURE_WINDOW_MS = 10 * 60 * 1000;
const FAILURE_THRESHOLD = 20;

@Injectable()
export class AuthAuditService {
  private readonly log = new Logger(AuthAuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  private isPrivateOrLocalIp(ip: string): boolean {
    if (!ip) return true;
    const s = ip.trim().toLowerCase();
    if (s === '::1' || s === '127.0.0.1' || s === 'unknown') return true;
    if (s.startsWith('192.168.')) return true;
    if (s.startsWith('10.')) return true;
    if (s.startsWith('172.')) {
      const parts = s.split('.');
      const n = parseInt(parts[1] || '0', 10);
      if (n >= 16 && n <= 31) return true;
    }
    if (s.startsWith('fe80:') || s === '::ffff:127.0.0.1') return true;
    return false;
  }

  /**
   * Geo vía ipapi.co (HTTPS, cuota gratuita). Falla en silencio → ciudad/país vacíos.
   */
  async lookupGeo(ip: string): Promise<GeoLookupResult> {
    if (this.isPrivateOrLocalIp(ip)) {
      return { city: '', country: '' };
    }
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), GEO_TIMEOUT_MS);
      const res = await fetch(
        `https://ipapi.co/${encodeURIComponent(ip)}/json/`,
        {
          signal: ctrl.signal,
          headers: { Accept: 'application/json' },
        },
      );
      clearTimeout(t);
      if (!res.ok) return { city: '', country: '' };
      const data = (await res.json()) as Record<string, unknown>;
      if (data.error) return { city: '', country: '' };
      const city = String(data.city ?? '').slice(0, 120);
      const country = String(data.country_name ?? data.country ?? '').slice(
        0,
        120,
      );
      return { city, country };
    } catch {
      return { city: '', country: '' };
    }
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase().slice(0, 100);
  }

  private async markBruteForceClusterIfNeeded(
    emailNormalized: string,
  ): Promise<void> {
    const since = new Date(Date.now() - FAILURE_WINDOW_MS);
    const count = await this.prisma.authAuditLog.count({
      where: {
        emailAttempted: emailNormalized,
        action: AuthAuditAction.LOGIN_FAILURE,
        createdAt: { gte: since },
      },
    });
    if (count < FAILURE_THRESHOLD) return;

    await this.prisma.authAuditLog.updateMany({
      where: {
        emailAttempted: emailNormalized,
        action: AuthAuditAction.LOGIN_FAILURE,
        createdAt: { gte: since },
      },
      data: { isSuspicious: true },
    });

    this.log.error(
      `[AuthAudit] Posible fuerza bruta: ${count} intentos fallidos en ${FAILURE_WINDOW_MS / 60000} min para email="${emailNormalized}" (marca isSuspicious en el cluster).`,
    );

    await this.applyLockoutForEmail(emailNormalized);
  }

  /** Bloquea cuenta 15 min si existe usuario con ese correo (normalizado). */
  private async applyLockoutForEmail(emailNormalized: string): Promise<void> {
    if (!emailNormalized || emailNormalized === '(vacío)') return;
    const user = await this.prisma.user.findFirst({
      where: {
        email: { equals: emailNormalized, mode: 'insensitive' },
      },
      select: { id: true },
    });
    if (!user) return;
    const until = new Date(Date.now() + 15 * 60 * 1000);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lockoutUntil: until },
    });
    this.log.warn(
      `[AuthAudit] lockoutUntil=${until.toISOString()} userId=${user.id} email=${emailNormalized}`,
    );
  }

  async recordLoginFailure(params: {
    emailAttempted: string;
    userId: string | null;
    ip: string;
    userAgent: string;
    city: string;
    country: string;
  }): Promise<void> {
    const emailNorm = this.normalizeEmail(params.emailAttempted || '(vacío)');
    await this.prisma.authAuditLog.create({
      data: {
        userId: params.userId,
        emailAttempted: emailNorm,
        action: AuthAuditAction.LOGIN_FAILURE,
        ipAddress: params.ip.slice(0, 64),
        userAgent: params.userAgent.slice(0, 512),
        city: params.city.slice(0, 120),
        country: params.country.slice(0, 120),
        isSuspicious: false,
      },
    });
    await this.markBruteForceClusterIfNeeded(emailNorm);
  }

  async recordLoginSuccess(params: {
    userId: string;
    email: string;
    ip: string;
    userAgent: string;
    city: string;
    country: string;
  }): Promise<{ isSuspicious: boolean }> {
    const emailNorm = this.normalizeEmail(params.email);
    let isSuspicious = false;

    const lastSuccess = await this.prisma.authAuditLog.findFirst({
      where: {
        userId: params.userId,
        action: AuthAuditAction.LOGIN_SUCCESS,
      },
      orderBy: { createdAt: 'desc' },
      select: {
        country: true,
        city: true,
        ipAddress: true,
      },
    });

    if (lastSuccess) {
      const prevCountry = (lastSuccess.country ?? '').trim().toLowerCase();
      const curCountry = (params.country ?? '').trim().toLowerCase();
      const countryChanged =
        !!prevCountry && !!curCountry && prevCountry !== curCountry;
      const prevIp = (lastSuccess.ipAddress ?? '').trim();
      const curIp = (params.ip ?? '').trim();
      const ipChanged = !!prevIp && !!curIp && prevIp !== curIp;
      if (countryChanged || ipChanged) {
        isSuspicious = true;
        this.log.warn(
          `[AuthAudit] LOGIN_SUCCESS inusual userId=${params.userId} país=${countryChanged} ip=${ipChanged}`,
        );
      }
    }

    await this.prisma.authAuditLog.create({
      data: {
        userId: params.userId,
        emailAttempted: emailNorm,
        action: AuthAuditAction.LOGIN_SUCCESS,
        ipAddress: params.ip.slice(0, 64),
        userAgent: params.userAgent.slice(0, 512),
        city: params.city.slice(0, 120),
        country: params.country.slice(0, 120),
        isSuspicious,
      },
    });
    return { isSuspicious };
  }

  /**
   * Contexto de acceso poco habitual para el segundo factor por correo (roles en
   * `USER_ROLES_WITH_EMAIL_STEP_UP`). Hoy solo hay lógica de IP/historial para `SUPER_ADMIN`.
   */
  async shouldRequireEmailContextStepUp(params: {
    userId: string;
    role: string;
    ip: string;
    country: string;
  }): Promise<boolean> {
    if (
      !(USER_ROLES_WITH_EMAIL_STEP_UP as readonly string[]).includes(
        params.role,
      )
    ) {
      return false;
    }
    if (params.role === 'SUPER_ADMIN') {
      return this.shouldRequireSuperAdminLocationStepUp({
        userId: params.userId,
        ip: params.ip,
        country: params.country,
      });
    }
    return false;
  }

  /**
   * @internal Lógica de “contexto poco habitual” para Super Admin (IP/país / frecuencia).
   */
  private async shouldRequireSuperAdminLocationStepUp(params: {
    userId: string;
    ip: string;
    country: string;
  }): Promise<boolean> {
    if (this.isPrivateOrLocalIp(params.ip)) {
      return false;
    }
    const lastSuccess = await this.prisma.authAuditLog.findFirst({
      where: {
        userId: params.userId,
        action: AuthAuditAction.LOGIN_SUCCESS,
      },
      orderBy: { createdAt: 'desc' },
      select: {
        country: true,
        ipAddress: true,
      },
    });

    if (!lastSuccess) {
      return true;
    }

    const prevCountry = (lastSuccess.country ?? '').trim().toLowerCase();
    const curCountry = (params.country ?? '').trim().toLowerCase();
    const countryChanged =
      !!prevCountry && !!curCountry && prevCountry !== curCountry;
    const prevIp = (lastSuccess.ipAddress ?? '').trim();
    const curIp = (params.ip ?? '').trim();
    const ipChanged = !!prevIp && !!curIp && prevIp !== curIp;
    if (countryChanged || ipChanged) {
      return true;
    }

    const recent = await this.prisma.authAuditLog.findMany({
      where: {
        userId: params.userId,
        action: AuthAuditAction.LOGIN_SUCCESS,
      },
      orderBy: { createdAt: 'desc' },
      take: 25,
      select: { ipAddress: true },
    });
    const sameIpCount = recent.filter(
      (r) => (r.ipAddress ?? '').trim() === curIp,
    ).length;
    if (sameIpCount >= 2) {
      return false;
    }
    return true;
  }

  async recordPasswordChange(params: {
    userId: string;
    email: string;
    ip: string;
    userAgent: string;
    city: string;
    country: string;
  }): Promise<void> {
    await this.prisma.authAuditLog.create({
      data: {
        userId: params.userId,
        emailAttempted: this.normalizeEmail(params.email),
        action: AuthAuditAction.PASSWORD_CHANGE,
        ipAddress: params.ip.slice(0, 64),
        userAgent: params.userAgent.slice(0, 512),
        city: params.city.slice(0, 120),
        country: params.country.slice(0, 120),
        isSuspicious: false,
      },
    });
  }

  async recordLogout(params: {
    userId: string;
    email: string;
    ip: string;
    userAgent: string;
    city: string;
    country: string;
  }): Promise<void> {
    await this.prisma.authAuditLog.create({
      data: {
        userId: params.userId,
        emailAttempted: this.normalizeEmail(params.email),
        action: AuthAuditAction.LOGOUT,
        ipAddress: params.ip.slice(0, 64),
        userAgent: params.userAgent.slice(0, 512),
        city: params.city.slice(0, 120),
        country: params.country.slice(0, 120),
        isSuspicious: false,
      },
    });
  }

  /** Últimos inicios de sesión exitosos con aviso si IP/ciudad difieren del intento anterior. */
  async getRecentLoginSuccesses(userId: string, take = 5) {
    const rows = await this.prisma.authAuditLog.findMany({
      where: { userId, action: AuthAuditAction.LOGIN_SUCCESS },
      orderBy: { createdAt: 'desc' },
      take: take + 1,
      select: {
        id: true,
        createdAt: true,
        city: true,
        country: true,
        ipAddress: true,
        userAgent: true,
        isSuspicious: true,
      },
    });

    const display = rows.slice(0, take);
    return display.map((row, i) => {
      const older = rows[i + 1];
      const locKey = (c: string, co: string) =>
        `${(c || '').trim().toLowerCase()}|${(co || '').trim().toLowerCase()}`;
      const ipChanged = older ? older.ipAddress !== row.ipAddress : false;
      const locChanged = older
        ? locKey(older.city, older.country) !== locKey(row.city, row.country)
        : false;
      const unusualLocationOrIp = !!older && (ipChanged || locChanged);

      return {
        ...row,
        deviceLabel: summarizeUserAgent(row.userAgent),
        unusualLocationOrIp,
      };
    });
  }
}

/** Etiqueta corta de dispositivo/navegador sin dependencias externas. */
export function summarizeUserAgent(ua: string): string {
  if (!ua) return '—';
  const u = ua.slice(0, 280);
  let name = 'Navegador';
  if (/Edg\//i.test(u)) name = 'Edge';
  else if (/Chrome\//i.test(u) && !/Chromium/i.test(u)) name = 'Chrome';
  else if (/Firefox\//i.test(u)) name = 'Firefox';
  else if (/Safari\//i.test(u) && !/Chrome/i.test(u)) name = 'Safari';
  let os = '';
  if (/Windows NT 10/i.test(u)) os = 'Windows';
  else if (/Windows NT 11/i.test(u)) os = 'Windows';
  else if (/Mac OS X/i.test(u)) os = 'macOS';
  else if (/Android/i.test(u)) os = 'Android';
  else if (/iPhone|iPad/i.test(u)) os = 'iOS';
  else if (/Linux/i.test(u)) os = 'Linux';
  const parts = [name, os].filter(Boolean);
  return parts.join(' · ') || u.slice(0, 80);
}
