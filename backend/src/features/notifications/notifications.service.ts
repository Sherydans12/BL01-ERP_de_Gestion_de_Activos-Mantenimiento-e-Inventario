import {
  Injectable,
  Logger,
  OnModuleInit,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as webpush from 'web-push';
import { PrismaService } from '../../prisma/prisma.service';
import type { SubscribePushDto } from './dto/subscribe-push.dto';

@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger(NotificationsService.name);
  private vapidConfigured = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    const publicKey = this.config.get<string>('VAPID_PUBLIC_KEY')?.trim();
    const privateKey = this.config.get<string>('VAPID_PRIVATE_KEY')?.trim();
    const subject =
      this.config.get<string>('VAPID_SUBJECT')?.trim() ||
      'mailto:admin@baselogic.local';

    if (publicKey && privateKey) {
      webpush.setVapidDetails(subject, publicKey, privateKey);
      this.vapidConfigured = true;
      this.logger.log('Web Push VAPID configurado.');
    } else {
      this.logger.warn(
        'VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY no definidas: las notificaciones push estarán deshabilitadas.',
      );
    }
  }

  /**
   * Guarda o actualiza la suscripción push del usuario (identificador único: endpoint).
   */
  async saveSubscription(
    user: { id: string; tenantId: string | null },
    dto: SubscribePushDto,
  ) {
    if (!user.tenantId) {
      throw new BadRequestException(
        'El usuario debe pertenecer a una organización para recibir notificaciones.',
      );
    }
    if (
      !dto?.endpoint?.trim() ||
      !dto.keys?.p256dh?.trim() ||
      !dto.keys?.auth?.trim()
    ) {
      throw new BadRequestException(
        'Suscripción inválida: se requiere endpoint y keys.p256dh / keys.auth.',
      );
    }

    return this.prisma.pushSubscription.upsert({
      where: { endpoint: dto.endpoint },
      create: {
        tenantId: user.tenantId,
        userId: user.id,
        endpoint: dto.endpoint,
        p256dh: dto.keys.p256dh,
        auth: dto.keys.auth,
      },
      update: {
        tenantId: user.tenantId,
        userId: user.id,
        p256dh: dto.keys.p256dh,
        auth: dto.keys.auth,
      },
    });
  }

  /**
   * Envía una notificación web push a todas las suscripciones activas del usuario.
   *
   * El cuerpo debe cumplir el formato que consume `@angular/service-worker` en
   * `handlePush`: objeto con `notification.title` obligatorio; el resto de opciones
   * (p. ej. `body`, `data`) van dentro de `notification` para pasar a
   * `showNotification(title, options)` y a `SwPush.notificationClicks` en el cliente.
   *
   * @see https://github.com/angular/angular/blob/main/packages/service-worker/worker/src/driver.ts (handlePush)
   */
  async sendNotification(
    userId: string,
    title: string,
    body: string,
    data?: Record<string, string>,
  ): Promise<void> {
    if (!this.vapidConfigured) {
      return;
    }

    const subs = await this.prisma.pushSubscription.findMany({
      where: { userId },
    });

    const payload = JSON.stringify({
      notification: {
        title,
        body,
        data: data ?? {},
      },
    });

    for (const sub of subs) {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          payload,
          { TTL: 86_400 },
        );
      } catch (err: unknown) {
        const status = (err as { statusCode?: number })?.statusCode;
        if (status === 404 || status === 410) {
          await this.prisma.pushSubscription
            .delete({ where: { id: sub.id } })
            .catch(() => {});
          this.logger.debug(
            `Suscripción push eliminada (${status}): ${sub.id}`,
          );
        } else {
          this.logger.warn(
            `Fallo al enviar push a suscripción ${sub.id}: ${String(err)}`,
          );
        }
      }
    }
  }
}
