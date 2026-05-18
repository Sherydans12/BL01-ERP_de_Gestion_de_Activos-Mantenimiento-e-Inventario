import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { EmailModule } from '../../common/email/email.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { NotificationSettingsService } from './notification-settings.service';
import { NotificationSettingsController } from './notification-settings.controller';
import { NotificationDispatcherService } from '../../common/notifications/notification-dispatcher.service';

@Module({
  imports: [PrismaModule, EmailModule, NotificationsModule],
  controllers: [NotificationSettingsController],
  providers: [NotificationSettingsService, NotificationDispatcherService],
  exports: [NotificationDispatcherService],
})
export class NotificationSettingsModule {}
