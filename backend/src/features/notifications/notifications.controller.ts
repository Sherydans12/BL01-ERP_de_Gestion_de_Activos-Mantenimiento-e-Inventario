import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { SubscribePushDto } from './dto/subscribe-push.dto';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Post('subscribe')
  subscribe(@Req() req: any, @Body() body: SubscribePushDto) {
    return this.notifications.saveSubscription(req.user, body);
  }
}
