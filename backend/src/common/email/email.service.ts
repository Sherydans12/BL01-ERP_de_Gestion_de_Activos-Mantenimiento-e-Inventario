import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

export interface SendMailOptions {
  to: string | string[];
  subject: string;
  html: string;
  from?: string;
  cc?: string | string[];
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly client: Resend | null;
  private readonly defaultFrom: string;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('RESEND_API_KEY')?.trim();
    const fromEmail =
      this.config.get<string>('RESEND_FROM_EMAIL')?.trim() ??
      'alertas@mail.baselogic.cl';
    const fromName =
      this.config.get<string>('RESEND_FROM_NAME')?.trim() ??
      'Sistema BaseLogic';

    this.defaultFrom = `${fromName} <${fromEmail}>`;

    if (!apiKey) {
      this.client = null;
      this.logger.warn(
        'RESEND_API_KEY no está configurada; el envío de correos estará deshabilitado.',
      );
      return;
    }

    this.client = new Resend(apiKey);
  }

  async sendMail(options: SendMailOptions): Promise<void> {
    if (!this.client) {
      throw new ServiceUnavailableException(
        'Servicio de correo no configurado en el servidor.',
      );
    }

    const { error } = await this.client.emails.send({
      from: options.from ?? this.defaultFrom,
      to: options.to,
      ...(options.cc ? { cc: options.cc } : {}),
      subject: options.subject,
      html: options.html,
    });

    if (error) {
      this.logger.warn(`Resend API error: ${error.message}`);
      throw new ServiceUnavailableException(
        'No se pudo enviar el correo en este momento.',
      );
    }
  }
}
