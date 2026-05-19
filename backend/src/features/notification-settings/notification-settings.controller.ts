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
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { SystemPermissions } from '../auth/constants/permissions.enum';
import { NotificationSettingsService } from './notification-settings.service';
import { UpsertTenantNotificationSettingDto } from './dto/upsert-tenant-notification-setting.dto';
import { UpsertUserNotificationSettingDto } from './dto/upsert-user-notification-setting.dto';

function canManageOthersNotifications(user: {
  role?: string;
  permissions?: string[];
}): boolean {
  if (user.role === 'SUPER_ADMIN' || user.role === 'ADMIN') {
    return true;
  }
  const perms = user.permissions ?? [];
  return perms.includes(SystemPermissions.ADMIN_NOTIFICATION_MANAGE_SETTINGS);
}

@Controller('notification-settings')
@UseGuards(JwtAuthGuard)
export class NotificationSettingsController {
  constructor(private readonly service: NotificationSettingsService) {}

  @Get('tenant')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(SystemPermissions.ADMIN_NOTIFICATION_READ)
  getTenantSettings(@Req() req: any) {
    return this.service.findTenantSettings(req.user.tenantId);
  }

  @Put('tenant')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(SystemPermissions.ADMIN_NOTIFICATION_MANAGE_SETTINGS)
  upsertTenantSetting(
    @Req() req: any,
    @Body() dto: UpsertTenantNotificationSettingDto,
  ) {
    return this.service.upsertTenantSetting(req.user.tenantId, dto);
  }

  @Get('user')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(SystemPermissions.ADMIN_NOTIFICATION_READ)
  getUserSettings(@Req() req: any, @Query('userId') userId?: string) {
    return this.service.findUserSettings(
      req.user.tenantId,
      userId ?? req.user.id,
    );
  }

  @Get('event')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(SystemPermissions.ADMIN_NOTIFICATION_READ)
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
    const targetUserId = dto.targetUserId ?? callerId;

    if (targetUserId !== callerId && !canManageOthersNotifications(req.user)) {
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
