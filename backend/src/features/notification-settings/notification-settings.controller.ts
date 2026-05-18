import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { NotificationSettingsService } from './notification-settings.service';
import { UpsertTenantNotificationSettingDto } from './dto/upsert-tenant-notification-setting.dto';
import { UpsertUserNotificationSettingDto } from './dto/upsert-user-notification-setting.dto';

const ADMIN_ROLES = ['ADMIN', 'SUPER_ADMIN'] as const;

@Controller('notification-settings')
@UseGuards(JwtAuthGuard)
export class NotificationSettingsController {
  constructor(private readonly service: NotificationSettingsService) {}

  // ── Tenant-level (solo ADMIN / SUPER_ADMIN) ────────────────────────────────

  @Get('tenant')
  @UseGuards(RolesGuard)
  @Roles(...ADMIN_ROLES)
  getTenantSettings(@Req() req: any) {
    return this.service.findTenantSettings(req.user.tenantId);
  }

  @Put('tenant')
  @UseGuards(RolesGuard)
  @Roles(...ADMIN_ROLES)
  upsertTenantSetting(
    @Req() req: any,
    @Body() dto: UpsertTenantNotificationSettingDto,
  ) {
    return this.service.upsertTenantSetting(req.user.tenantId, dto);
  }

  // ── User-level ─────────────────────────────────────────────────────────────
  // GET: solo ADMIN puede consultar preferencias de otros usuarios.
  // PUT: cualquier usuario autenticado puede gestionar sus propias preferencias;
  //      gestionar las de otros requiere ADMIN o SUPER_ADMIN.

  @Get('user')
  @UseGuards(RolesGuard)
  @Roles(...ADMIN_ROLES)
  getUserSettings(@Req() req: any, @Query('userId') userId?: string) {
    return this.service.findUserSettings(
      req.user.tenantId,
      userId ?? req.user.id,
    );
  }

  /**
   * Lista todas las suscripciones (con datos del usuario) para un evento específico.
   * Usado por el panel de gobernanza.
   */
  @Get('event')
  @UseGuards(RolesGuard)
  @Roles(...ADMIN_ROLES)
  getEventSubscribers(
    @Req() req: any,
    @Query('eventKey') eventKey: string,
  ) {
    return this.service.findEventSubscribers(req.user.tenantId, eventKey);
  }

  @Put('user')
  upsertUserSetting(
    @Req() req: any,
    @Body() dto: UpsertUserNotificationSettingDto,
  ) {
    const callerId: string = req.user.id;
    const callerRole: string = req.user.role;
    const targetUserId = dto.targetUserId ?? callerId;

    // Gestión delegada: un usuario no-admin no puede modificar preferencias ajenas
    if (
      targetUserId !== callerId &&
      !ADMIN_ROLES.includes(callerRole as (typeof ADMIN_ROLES)[number])
    ) {
      throw new ForbiddenException(
        'No tienes permisos para modificar las preferencias de notificación de otros usuarios.',
      );
    }

    return this.service.upsertUserSetting(
      req.user.tenantId,
      targetUserId,
      dto,
    );
  }
}
