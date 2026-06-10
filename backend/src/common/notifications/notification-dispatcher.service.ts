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
   * Puede ser `[]` cuando el evento usa solo `TenantNotificationSetting.ccEmails`
   * (p. ej. `INVENTORY_ITEM_CREATED`).
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
   * 1. **Interruptor de tenant** — Si existe `TenantNotificationSetting` y
   *    `enabled = false`, aborta. Recupera `ccEmails` del registro (si existe).
   *
   * 2. **Destinatarios** — Si `userIds` está vacío y hay `ccEmails`, modo **solo CC**
   *    (p. ej. `INVENTORY_ITEM_CREATED`): envía un correo a esas direcciones si el
   *    interruptor del tenant está activo (`enabled = true` en el registro).
   *    Si no hay `userIds` ni `ccEmails`, aborta.
   *
   * 3. **Opt-in estricto (usuarios)** — Con `userIds` no vacío: consulta
   *    `UserNotificationSetting` filtrando `{ tenantId, eventKey, enabled: true,
   *    userId: { in: userIds } }`. Solo usuarios con registro explícito y activos.
   *    Si nadie califica pero hay `ccEmails` e interruptor activo, **fallback**:
   *    correo solo a CC (mismo criterio que el paso 2).
   *
   * 4. **Envío** — EMAIL vía `EmailService.sendMail` (usuarios en `to`, `ccEmails`
   *    del tenant en `cc` cuando aplica); WEB_PUSH si hay payload y suscriptores.
   *    Si tras agrupar canales no queda ningún envío pero hay CC configurados,
   *    se envía correo solo a CC (p. ej. suscriptores solo WEB_PUSH en un evento
   *    sin `pushPayload`).
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
    const hasUserCandidates = payload.userIds.length > 0;
    const hasCc = tenantCcEmails.length > 0;

    // ── 2. Sin usuarios ni CC → nada que enviar ───────────────────────────────
    if (!hasUserCandidates && !hasCc) {
      this.logger.debug(
        `[${eventKey}] Sin destinatarios (userIds vacío y sin ccEmails); abortado (tenant ${tenantId}).`,
      );
      return;
    }

    // ── 3. Modo solo CC (ej. INVENTORY_ITEM_CREATED: userIds intencionalmente []) ─
    if (!hasUserCandidates && hasCc) {
      if (!tenantSetting || !tenantSetting.enabled) {
        this.logger.debug(
          `[${eventKey}] Solo CC requiere registro de tenant con enabled=true; abortado (tenant ${tenantId}).`,
        );
        return;
      }
      await this.emailService
        .sendMail({
          to: tenantCcEmails,
          subject: payload.subject,
          html: payload.html,
        })
        .catch((err: unknown) => {
          this.logger.error(
            `[${eventKey}] Error al enviar EMAIL (solo CC): ${String(err)}`,
          );
        });
      this.logger.log(
        `[${eventKey}] Despachado: correo solo a ${tenantCcEmails.length} CC (tenant ${tenantId}).`,
      );
      return;
    }

    // ── 4. Opt-in estricto: solo suscripciones explícitamente activas ─────────
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
      if (hasCc && tenantSetting?.enabled) {
        await this.emailService
          .sendMail({
            to: tenantCcEmails,
            subject: payload.subject,
            html: payload.html,
          })
          .catch((err: unknown) => {
            this.logger.error(
              `[${eventKey}] Error al enviar EMAIL (solo CC, sin opt-in en pool): ${String(err)}`,
            );
          });
        this.logger.log(
          `[${eventKey}] Despachado: correo solo a ${tenantCcEmails.length} CC — pool sin suscripciones activas (tenant ${tenantId}).`,
        );
        return;
      }
      this.logger.debug(
        `[${eventKey}] Sin suscripciones opt-in activas (tenant ${tenantId}).`,
      );
      return;
    }

    // ── 5. Agrupar por canal ──────────────────────────────────────────────────
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

    // ── 6. Envío en paralelo ─────────────────────────────────────────────────
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

    if (tasks.length === 0 && hasCc && tenantSetting?.enabled) {
      tasks.push(
        this.emailService
          .sendMail({
            to: tenantCcEmails,
            subject: payload.subject,
            html: payload.html,
          })
          .catch((err: unknown) => {
            this.logger.error(
              `[${eventKey}] Error al enviar EMAIL (solo CC, sin tareas usuario/push): ${String(err)}`,
            );
          }),
      );
    }

    await Promise.all(tasks);

    const pushDispatched =
      pushUserIds.length && payload.pushPayload ? pushUserIds.length : 0;
    this.logger.log(
      `[${eventKey}] Completado (tenant ${tenantId}): emails a usuarios opt-in=${emailAddresses.length}, push=${pushDispatched}, tareas=${tasks.length}, CC en tenant=${tenantCcEmails.length}.`,
    );
  }
}
