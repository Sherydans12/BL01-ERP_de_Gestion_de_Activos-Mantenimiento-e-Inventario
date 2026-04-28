import {
  ForbiddenException,
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { Prisma } from '@prisma/client';
import { AuthAuditAction } from '@prisma/client';
import { ConfigService } from '@nestjs/config';

import { PLATFORM_SECURITY_SETTINGS_ID } from '../auth/platform-security.constants';

const HOURS_24_MS = 24 * 60 * 60 * 1000;

export interface SecurityDashboardStatsDto {
  /** Usuarios con al menos una sesión JWT activa (`user_sessions.is_valid`). */
  onlineUsersCount: number;
  /** Total de sesiones activas en el alcance. */
  activeSessionsCount: number;
  /** `auth_audit_logs` con `is_suspicious` en las últimas 24 h. */
  suspiciousAlerts24h: number;
  /** Intentos de login fallidos en las últimas 24 h (usuario del tenant). */
  loginFailures24h: number;
}

@Injectable()
export class SecurityAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private assertTenantScope(requester: {
    tenantId: string | null;
    role: string;
  }): void {
    if (requester.role === 'ADMIN' && !requester.tenantId) {
      throw new ForbiddenException(
        'Sin contexto de tenant para esta operación.',
      );
    }
  }

  private userTenantWhere(
    tenantId: string | null,
    role: string,
  ): Prisma.UserWhereInput | undefined {
    if (role === 'ADMIN') {
      if (!tenantId) return undefined;
      return { tenantId };
    }
    if (tenantId) return { tenantId };
    return undefined;
  }

  async getDashboardStats(requester: {
    tenantId: string | null;
    role: string;
  }): Promise<SecurityDashboardStatsDto> {
    this.assertTenantScope(requester);
    const since = new Date(Date.now() - HOURS_24_MS);
    const userWhere = this.userTenantWhere(requester.tenantId, requester.role);

    const sessionWhere: Prisma.UserSessionWhereInput = {
      isValid: true,
      ...(userWhere ? { user: userWhere } : {}),
    };

    const distinctUsers = await this.prisma.userSession.findMany({
      where: sessionWhere,
      distinct: ['userId'],
      select: { userId: true },
    });
    const activeSessionsCount = await this.prisma.userSession.count({
      where: sessionWhere,
    });

    const auditUserFilter: Prisma.AuthAuditLogWhereInput = userWhere
      ? { user: userWhere }
      : {};

    const [suspiciousAlerts24h, loginFailures24h] = await Promise.all([
      this.prisma.authAuditLog.count({
        where: {
          isSuspicious: true,
          createdAt: { gte: since },
          ...auditUserFilter,
        },
      }),
      this.prisma.authAuditLog.count({
        where: {
          action: AuthAuditAction.LOGIN_FAILURE,
          createdAt: { gte: since },
          ...auditUserFilter,
        },
      }),
    ]);

    return {
      onlineUsersCount: distinctUsers.length,
      activeSessionsCount,
      suspiciousAlerts24h,
      loginFailures24h,
    };
  }

  /**
   * Sesiones activas en el tenant (o en todo el sistema si SUPER_ADMIN sin `tenantId`).
   */
  async listActiveSessionsForTenant(requester: {
    tenantId: string | null;
    role: string;
  }) {
    this.assertTenantScope(requester);
    const userWhere = this.userTenantWhere(requester.tenantId, requester.role);
    return this.prisma.userSession.findMany({
      where: {
        isValid: true,
        ...(userWhere ? { user: userWhere } : {}),
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            name: true,
            tenantId: true,
          },
        },
      },
      orderBy: { lastActiveAt: 'desc' },
      take: 2000,
    });
  }

  /** Revoca una sesión concreta si pertenece al tenant del administrador (o global si aplica). */
  async adminRevokeSession(
    sessionId: string,
    requester: { tenantId: string | null; role: string },
  ): Promise<void> {
    this.assertTenantScope(requester);
    const row = await this.prisma.userSession.findFirst({
      where: { id: sessionId },
      include: {
        user: { select: { tenantId: true } },
      },
    });
    if (!row) throw new NotFoundException('Sesión no encontrada');
    if (requester.tenantId) {
      if (!row.user || row.user.tenantId !== requester.tenantId) {
        throw new ForbiddenException('Sesión fuera de su tenant.');
      }
    }
    await this.prisma.userSession.update({
      where: { id: sessionId },
      data: { isValid: false },
    });
  }

  /**
   * Registros de auditoría marcados como sospechosos (fuerza bruta, login inusual, etc.).
   * Alcance por tenant del solicitante; si no tiene `tenantId`, ve todo el historial.
   */
  async listSuspiciousAuthLogs(requester: {
    tenantId: string | null;
    role: string;
  }): Promise<
    Prisma.AuthAuditLogGetPayload<{
      include: {
        user: {
          select: {
            id: true;
            email: true;
            name: true;
            tenantId: true;
          };
        };
      };
    }>[]
  > {
    this.assertTenantScope(requester);
    const where: Prisma.AuthAuditLogWhereInput = {
      isSuspicious: true,
    };
    const uw = this.userTenantWhere(requester.tenantId, requester.role);
    if (uw) {
      where.user = uw;
    }
    return this.prisma.authAuditLog.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            name: true,
            tenantId: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
  }

  async getGlobalAuthSettings(requester: { role: string }) {
    if (requester.role !== 'SUPER_ADMIN' && requester.role !== 'ADMIN') {
      throw new ForbiddenException();
    }
    const row = await this.prisma.platformSecuritySettings.findUnique({
      where: { id: PLATFORM_SECURITY_SETTINGS_ID },
    });
    return {
      superAdminStepUpEmailEnabled:
        row?.superAdminStepUpEmailEnabled ?? false,
      authStepUpLocalBypass:
        this.config.get<string>('AUTH_STEP_UP_BYPASS', '') === 'true',
    };
  }

  async updateGlobalAuthSettings(
    body: { superAdminStepUpEmailEnabled: boolean },
    requester: { role: string },
  ) {
    if (requester.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException(
        'Solo un super administrador de plataforma puede modificar esta política.',
      );
    }
    if (typeof body.superAdminStepUpEmailEnabled !== 'boolean') {
      throw new BadRequestException(
        'superAdminStepUpEmailEnabled debe ser booleano.',
      );
    }
    await this.prisma.platformSecuritySettings.upsert({
      where: { id: PLATFORM_SECURITY_SETTINGS_ID },
      create: {
        id: PLATFORM_SECURITY_SETTINGS_ID,
        superAdminStepUpEmailEnabled: body.superAdminStepUpEmailEnabled,
      },
      update: {
        superAdminStepUpEmailEnabled: body.superAdminStepUpEmailEnabled,
      },
    });
    return {
      superAdminStepUpEmailEnabled: body.superAdminStepUpEmailEnabled,
      authStepUpLocalBypass:
        this.config.get<string>('AUTH_STEP_UP_BYPASS', '') === 'true',
    };
  }
}
