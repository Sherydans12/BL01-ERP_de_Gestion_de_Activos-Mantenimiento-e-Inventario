import { Injectable, Logger } from '@nestjs/common';
import { NotificationChannel } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { NotificationsService } from '../../features/notifications/notifications.service';

export interface DispatchPayload {
  /**
   * IDs de los usuarios candidatos al evento. El dispatcher solo enviará a
   * quienes tengan un registro explícito `enabled = true` en
   * `UserNotificationSetting` para el canal correspondiente (modelo opt-in).
   * Si no existe registro, la notificación está apagada por defecto.
   */
  userIds: string[];
  /** Asunto del correo (canal EMAIL). */
  subject: string;
  /**
   * HTML del cuerpo del correo (canal EMAIL).
   * Usar `buildTpmEmailHtml()` de `email-templates.ts` para correos transaccionales.
   */
  html: string;
  /** Payload para Web Push (canal WEB_PUSH). Si no se provee, el push no se envía. */
  pushPayload?: {
    title: string;
    body: string;
    data?: Record<string, string>;
  };
}

@Injectable()
export class NotificationDispatcherService {
  private readonly logger = new Logger(NotificationDispatcherService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly notificationsService: NotificationsService,
  ) {}

  /**
   * Despacha un evento de notificación con modelo **opt-in estricto**:
   *
   * 1. **Interruptor de tenant** — Si `TenantNotificationSetting.enabled = false`,
   *    aborta. También recupera `ccEmails` (destinatarios CC fijos del tenant).
   *
   * 2. **Guard de userIds** — Si el array está vacío, aborta.
   *
   * 3. **Opt-in estricto (única consulta)** — Lee `UserNotificationSetting` filtrando
   *    `{ tenantId, eventKey, enabled: true, userId: { in: userIds } }` con
   *    `include: { user: { select: { id, email, isActive } } }`.
   *    Solo los usuarios con registro explícito `enabled = true` y `isActive = true`
   *    pasan al pipeline de envío. Sin registro → silencio por defecto.
   *
   * 4. **Agrupación por canal y envío paralelo** — EMAIL vía `EmailService.sendMail`
   *    (con CC del tenant si aplica); WEB_PUSH vía `NotificationsService.sendNotification`.
   */
  async dispatch(
    eventKey: string,
    tenantId: string,
    payload: DispatchPayload,
  ): Promise<void> {
    // ── 1. Interruptor maestro del tenant ────────────────────────────────────
    const tenantSetting =
      await this.prisma.tenantNotificationSetting.findUnique({
        where: { tenantId_eventKey: { tenantId, eventKey } },
      });

    if (tenantSetting && !tenantSetting.enabled) {
      this.logger.debug(
        `[${eventKey}] Evento desactivado para tenant ${tenantId}; dispatch abortado.`,
      );
      return;
    }

    const tenantCcEmails: string[] = tenantSetting?.ccEmails ?? [];

    // ── 2. Guard: lista de candidatos no vacía ────────────────────────────────
    if (!payload.userIds.length) {
      this.logger.debug(
        `[${eventKey}] userIds vacío; dispatch abortado (tenant ${tenantId}).`,
      );
      return;
    }

    // ── 3. Opt-in estricto: solo suscripciones explícitamente activas ─────────
    // Una única consulta resuelve preferencias + datos del usuario en paralelo.
    const activeSubscriptions =
      await this.prisma.userNotificationSetting.findMany({
        where: {
          tenantId,
          eventKey,
          enabled: true,
          userId: { in: payload.userIds },
        },
        select: {
          userId: true,
          channel: true,
          user: { select: { id: true, email: true, isActive: true } },
        },
      });

    // Descartar usuarios inactivos en la plataforma
    const validSubs = activeSubscriptions.filter((s) => s.user.isActive);

    if (!validSubs.length) {
      this.logger.debug(
        `[${eventKey}] Sin suscripciones opt-in activas (tenant ${tenantId}).`,
      );
      return;
    }

    // ── 4. Agrupar por canal ──────────────────────────────────────────────────
    const emailAddresses: string[] = [];
    const pushUserIds: string[] = [];

    for (const sub of validSubs) {
      if (sub.channel === NotificationChannel.EMAIL) {
        emailAddresses.push(sub.user.email);
      } else if (
        sub.channel === NotificationChannel.WEB_PUSH &&
        payload.pushPayload
      ) {
        pushUserIds.push(sub.userId);
      }
    }

    // ── 5. Envío en paralelo ─────────────────────────────────────────────────
    const tasks: Promise<void>[] = [];

    if (emailAddresses.length) {
      tasks.push(
        this.emailService
          .sendMail({
            to: emailAddresses,
            ...(tenantCcEmails.length ? { cc: tenantCcEmails } : {}),
            subject: payload.subject,
            html: payload.html,
          })
          .catch((err: unknown) => {
            this.logger.error(
              `[${eventKey}] Error al enviar EMAIL: ${String(err)}`,
            );
          }),
      );
    }

    if (pushUserIds.length && payload.pushPayload) {
      const { title, body, data } = payload.pushPayload;
      for (const uid of pushUserIds) {
        tasks.push(
          this.notificationsService
            .sendNotification(uid, title, body, data)
            .catch((err: unknown) => {
              this.logger.error(
                `[${eventKey}] Error al enviar WEB_PUSH a usuario ${uid}: ${String(err)}`,
              );
            }),
        );
      }
    }

    await Promise.all(tasks);

    this.logger.log(
      `[${eventKey}] Despachado: ${emailAddresses.length} emails` +
        (tenantCcEmails.length ? ` (+${tenantCcEmails.length} CC)` : '') +
        `, ${pushUserIds.length} push (tenant ${tenantId}).`,
    );
  }
}
