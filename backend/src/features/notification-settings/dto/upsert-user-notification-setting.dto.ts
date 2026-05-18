import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { NotificationChannel } from '@prisma/client';

export class UpsertUserNotificationSettingDto {
  /**
   * ID del usuario cuyas preferencias se modifican.
   * - Ausente o igual a `req.user.id` → auto-gestión (cualquier rol autenticado).
   * - Presente y diferente a `req.user.id` → requiere rol ADMIN o SUPER_ADMIN
   *   (validado en el controlador; lanza ForbiddenException si no se cumple).
   */
  @IsOptional()
  @IsUUID()
  targetUserId?: string;

  @IsString()
  @MaxLength(100)
  eventKey: string;

  @IsEnum(NotificationChannel)
  channel: NotificationChannel;

  @IsBoolean()
  enabled: boolean;
}
