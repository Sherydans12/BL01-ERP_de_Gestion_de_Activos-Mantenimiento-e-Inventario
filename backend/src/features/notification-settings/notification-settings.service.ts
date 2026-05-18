import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { UpsertTenantNotificationSettingDto } from './dto/upsert-tenant-notification-setting.dto';
import type { UpsertUserNotificationSettingDto } from './dto/upsert-user-notification-setting.dto';

@Injectable()
export class NotificationSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Tenant-level ──────────────────────────────────────────────────────────

  findTenantSettings(tenantId: string) {
    return this.prisma.tenantNotificationSetting.findMany({
      where: { tenantId },
      orderBy: { eventKey: 'asc' },
    });
  }

  upsertTenantSetting(
    tenantId: string,
    dto: UpsertTenantNotificationSettingDto,
  ) {
    const data = {
      enabled: dto.enabled,
      ...(dto.ccEmails !== undefined ? { ccEmails: dto.ccEmails } : {}),
    };
    return this.prisma.tenantNotificationSetting.upsert({
      where: { tenantId_eventKey: { tenantId, eventKey: dto.eventKey } },
      create: { tenantId, eventKey: dto.eventKey, ...data },
      update: data,
    });
  }

  // ── User-level ────────────────────────────────────────────────────────────

  findUserSettings(tenantId: string, userId: string) {
    return this.prisma.userNotificationSetting.findMany({
      where: { tenantId, userId },
      orderBy: [{ eventKey: 'asc' }, { channel: 'asc' }],
    });
  }

  /**
   * Lista todas las suscripciones de usuarios para un evento específico,
   * enriquecidas con datos básicos del usuario (nombre, email, rol).
   * Usado por el panel de gobernanza de notificaciones.
   */
  findEventSubscribers(tenantId: string, eventKey: string) {
    return this.prisma.userNotificationSetting.findMany({
      where: { tenantId, eventKey },
      orderBy: [{ channel: 'asc' }],
      select: {
        id: true,
        userId: true,
        eventKey: true,
        channel: true,
        enabled: true,
        createdAt: true,
        updatedAt: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            isActive: true,
            avatarUrl: true,
            customRole: { select: { id: true, name: true } },
          },
        },
      },
    });
  }

  /**
   * @param tenantId  Tenant del token JWT (siempre del caller autenticado).
   * @param resolvedUserId  ID del usuario destino ya validado en el controlador
   *   (puede ser el propio caller o un tercero si el caller es ADMIN/SUPER_ADMIN).
   * @param dto  Datos de la preferencia a persistir.
   */
  upsertUserSetting(
    tenantId: string,
    resolvedUserId: string,
    dto: UpsertUserNotificationSettingDto,
  ) {
    return this.prisma.userNotificationSetting.upsert({
      where: {
        tenantId_userId_eventKey_channel: {
          tenantId,
          userId: resolvedUserId,
          eventKey: dto.eventKey,
          channel: dto.channel,
        },
      },
      create: {
        tenantId,
        userId: resolvedUserId,
        eventKey: dto.eventKey,
        channel: dto.channel,
        enabled: dto.enabled,
      },
      update: { enabled: dto.enabled },
    });
  }
}
