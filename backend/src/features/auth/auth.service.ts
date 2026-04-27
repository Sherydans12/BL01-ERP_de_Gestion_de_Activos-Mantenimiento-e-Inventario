import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  NotFoundException,
  Logger,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { CaptchaService } from './captcha.service';
import { AuthAuditService, summarizeUserAgent } from './auth-audit.service';
import type { LoginRequestMeta } from './auth-request.util';
import { UserSessionService } from './user-session.service';
import { EmailService } from '../../common/email/email.service';
import { StorageService } from '../../common/storage/storage.service';

/** Hash bcrypt fijo para igualar tiempo de CPU cuando el usuario no existe (mitiga timing). */
const BCRYPT_DUMMY_HASH =
  '$2b$10$glmX0FcM1vg9l8kAY/MVzOerDopkjT0rt0DW0Rc/9zWNWZITKMRKW';

const FORGOT_PASSWORD_MESSAGE =
  'Si el correo existe en el sistema, recibirás un enlace de recuperación.';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface LoginDto {
  tenantCode?: string;
  email?: string;
  password?: string;
  challengeId?: string;
  challengeAnswer?: string | number;
  /** Campo trampa: los bots suelen rellenarlo; debe ir vacío. */
  honeypot?: string;
}

@Injectable()
export class AuthService {
  private readonly loginErrorMessage =
    'Credenciales inválidas o cuenta no activa';
  private readonly log = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private emailService: EmailService,
    private config: ConfigService,
    private captcha: CaptchaService,
    private readonly authAudit: AuthAuditService,
    private readonly userSessions: UserSessionService,
    private readonly storage: StorageService,
  ) {}

  private async sendUnusualLoginSecurityEmail(params: {
    toEmail: string;
    name: string;
    deviceLabel: string;
    city: string;
    country: string;
    ip: string;
  }) {
    try {
      await this.emailService.sendMail({
        to: params.toEmail,
        subject: 'Alerta de seguridad — acceso inusual en TPM',
        html: `
          <div style="font-family: sans-serif; color: #111;">
            <h2>Acceso marcado como inusual</h2>
            <p>Hola <strong>${params.name}</strong>,</p>
            <p>Se registró un inicio de sesión en <strong>TPM</strong> con ubicación o IP distinta a la habitual.</p>
            <ul>
              <li><strong>Dispositivo:</strong> ${params.deviceLabel}</li>
              <li><strong>IP:</strong> ${params.ip || '—'}</li>
              <li><strong>Ubicación (aprox.):</strong> ${[params.city, params.country].filter(Boolean).join(', ') || '—'}</li>
            </ul>
            <p>Si no fuiste tú, cambia tu contraseña y usa <strong>Cerrar todas las demás sesiones</strong> en Mi cuenta → Seguridad.</p>
          </div>
        `,
      });
    } catch (e) {
      this.log.warn(
        `No se pudo enviar alerta SecurityEvent.UnusualLogin: ${e}`,
      );
    }
  }

  private async ensureMinFailureDelay(started: number): Promise<void> {
    const minMs = 320;
    const jitter = Math.floor(Math.random() * 150);
    const elapsed = Date.now() - started;
    const wait = minMs + jitter - elapsed;
    if (wait > 0) await sleep(wait);
  }

  async login(dto: LoginDto, meta: LoginRequestMeta) {
    const started = Date.now();
    const geo = await this.authAudit.lookupGeo(meta.clientIp);
    const ip = (meta.clientIp || '').slice(0, 64);
    const ua = (meta.userAgent || '').slice(0, 512);

    const auditFail = async (
      emailAttempted: string,
      userId: string | null,
    ): Promise<void> => {
      try {
        await this.authAudit.recordLoginFailure({
          emailAttempted: emailAttempted || '(vacío)',
          userId,
          ip,
          userAgent: ua,
          city: geo.city,
          country: geo.country,
        });
      } catch (e) {
        this.log.warn(`No se pudo registrar LOGIN_FAILURE: ${e}`);
      }
    };

    const fail = async (
      emailAttempted: string,
      userId: string | null,
    ): Promise<never> => {
      await auditFail(emailAttempted, userId);
      await this.ensureMinFailureDelay(started);
      throw new UnauthorizedException(this.loginErrorMessage);
    };

    const tenantCode = dto.tenantCode?.trim() ?? '';
    const email = dto.email?.trim() ?? '';
    const pass = dto.password ?? '';

    if (dto.honeypot?.trim()) {
      await bcrypt.compare('x', BCRYPT_DUMMY_HASH);
      await fail(email, null);
    }

    if (!this.captcha.validate(dto.challengeId, dto.challengeAnswer)) {
      await bcrypt.compare('x', BCRYPT_DUMMY_HASH);
      await fail(email, null);
    }

    if (!email || !pass) {
      await bcrypt.compare('x', BCRYPT_DUMMY_HASH);
      await fail(email || '(vacío)', null);
    }

    const userRow = await this.prisma.user.findUnique({
      where: { email },
      include: {
        tenant: true,
        contractAccess: true,
        customRole: true,
      },
    });

    if (!userRow) {
      await bcrypt.compare('x', BCRYPT_DUMMY_HASH);
      await fail(email, null);
    }

    const user = userRow!;

    if (user.lockoutUntil && user.lockoutUntil > new Date()) {
      await auditFail(email, user.id);
      await this.ensureMinFailureDelay(started);
      throw new HttpException(
        'Cuenta bloqueada temporalmente por intentos fallidos. Intente de nuevo más tarde.',
        HttpStatus.LOCKED,
      );
    }

    // 1. Validación de Tenant (Aislamiento)
    if (
      user.role !== ('SUPER_ADMIN' as any) &&
      tenantCode &&
      user.tenant?.code !== tenantCode.toUpperCase()
    ) {
      await bcrypt.compare('x', BCRYPT_DUMMY_HASH);
      await fail(email, user.id);
    }

    // 2. Validación de Estado (Diferenciando flujo de invitación vs suspensión)
    if (!user.isActive) {
      await bcrypt.compare('x', BCRYPT_DUMMY_HASH);
      await fail(email, user.id);
    }

    // 3. Validación de Password
    const isMatch = await bcrypt.compare(pass, user.password);
    if (!isMatch) {
      await fail(email, user.id);
    }

    // 4. Extracción de Contratos Permitidos
    let allowedContracts: string[] = [];
    if (user.role === 'ADMIN' || user.role === ('SUPER_ADMIN' as any)) {
      allowedContracts = ['ALL']; // Corregido: unificada la variable
    } else {
      allowedContracts = user.contractAccess.map((access) => access.contractId);
    }

    // 5. Limpia bloqueo al autenticar correctamente
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lockoutUntil: null },
    });

    // 6. Auditoría éxito + alerta email si inusual
    try {
      const r = await this.authAudit.recordLoginSuccess({
        userId: user.id,
        email: user.email,
        ip,
        userAgent: ua,
        city: geo.city,
        country: geo.country,
      });
      if (r.isSuspicious) {
        void this.sendUnusualLoginSecurityEmail({
          toEmail: user.email,
          name: user.name,
          deviceLabel: summarizeUserAgent(ua),
          city: geo.city,
          country: geo.country,
          ip,
        });
      }
    } catch (e) {
      this.log.warn(`No se pudo registrar LOGIN_SUCCESS: ${e}`);
    }

    const jti = crypto.randomUUID();
    try {
      await this.userSessions.create({
        userId: user.id,
        jti,
        deviceLabel: summarizeUserAgent(ua),
        ipAddress: ip,
      });
    } catch (e) {
      this.log.error(`No se pudo crear sesión de usuario: ${e}`);
      throw new UnauthorizedException(
        'No se pudo iniciar sesión de forma segura.',
      );
    }

    // 7. Generación de Payload y Token
    const payload = {
      email: user.email,
      sub: user.id,
      role: user.role,
      tenantId: user.tenantId,
      allowedContracts,
      customRoleId: user.customRoleId ?? null,
      jti,
    };

    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        firstName: user.firstName ?? null,
        lastName: user.lastName ?? null,
        phone: user.phone ?? null,
        avatarUrl: user.avatarUrl
          ? await this.storage.getReadOnlyUrl(user.avatarUrl)
          : null,
        role: user.role,
        customRoleId: user.customRoleId ?? null,
        customRoleName: user.customRole?.name ?? null,
        tenant: user.tenant
          ? {
              id: user.tenant.id,
              name: user.tenant.name,
              logoUrl: user.tenant.logoUrl,
            }
          : null,
        allowedContracts,
      },
    };
  }

  /** Registro de logout explícito (cliente llama antes de borrar sesión). */
  async recordLogoutAudit(
    user: { id: string; email: string; jti?: string },
    meta: LoginRequestMeta,
  ) {
    if (user.jti) {
      await this.userSessions.revokeByJti(user.id, user.jti);
    }
    const geo = await this.authAudit.lookupGeo(meta.clientIp);
    await this.authAudit.recordLogout({
      userId: user.id,
      email: user.email,
      ip: (meta.clientIp || '').slice(0, 64),
      userAgent: (meta.userAgent || '').slice(0, 512),
      city: geo.city,
      country: geo.country,
    });
    return { ok: true };
  }

  async activateAccount(
    token: string,
    newPassword: string,
    meta: LoginRequestMeta,
  ) {
    const user = await this.prisma.user.findFirst({
      where: { activationToken: token },
      include: { tenant: true, contractAccess: true, customRole: true },
    });

    if (!user) {
      throw new NotFoundException('Token inválido o expirado.');
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    const updatedUser = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        isActive: true,
        activationToken: null,
      },
    });

    // 4. Extracción de Contratos Permitidos para el payload post-activación
    let allowedContracts: string[] = [];
    if (
      updatedUser.role === 'ADMIN' ||
      updatedUser.role === ('SUPER_ADMIN' as any)
    ) {
      allowedContracts = ['ALL']; // Corregido
    } else {
      allowedContracts = user.contractAccess.map((access) => access.contractId);
    }

    const ip = (meta.clientIp || '').slice(0, 64);
    const ua = (meta.userAgent || '').slice(0, 512);
    const jti = crypto.randomUUID();
    await this.userSessions.create({
      userId: updatedUser.id,
      jti,
      deviceLabel: summarizeUserAgent(ua),
      ipAddress: ip,
    });

    const payload = {
      email: updatedUser.email,
      sub: updatedUser.id,
      role: updatedUser.role,
      tenantId: updatedUser.tenantId,
      allowedContracts,
      customRoleId: user.customRoleId ?? null,
      jti,
    };

    return {
      message: 'Cuenta activada exitosamente',
      access_token: this.jwtService.sign(payload),
      user: {
        id: updatedUser.id,
        email: updatedUser.email,
        name: updatedUser.name,
        firstName: updatedUser.firstName ?? null,
        lastName: updatedUser.lastName ?? null,
        phone: updatedUser.phone ?? null,
        avatarUrl: updatedUser.avatarUrl
          ? await this.storage.getReadOnlyUrl(updatedUser.avatarUrl)
          : null,
        role: updatedUser.role,
        customRoleId: user.customRoleId ?? null,
        customRoleName: user.customRole?.name ?? null,
        tenant: user.tenant
          ? {
              id: user.tenant.id,
              name: user.tenant.name,
              logoUrl: user.tenant.logoUrl,
            }
          : null,
        allowedContracts, // Corregido
      },
    };
  }

  async forgotPassword(dto: {
    email?: string;
    challengeId?: string;
    challengeAnswer?: string | number;
    honeypot?: string;
  }) {
    const started = Date.now();

    const finishTiming = async () => {
      const minMs = 480;
      const jitter = Math.floor(Math.random() * 200);
      const elapsed = Date.now() - started;
      const wait = minMs + jitter - elapsed;
      if (wait > 0) await sleep(wait);
    };

    const genericOk = async () => {
      await bcrypt.compare('x', BCRYPT_DUMMY_HASH);
      await finishTiming();
      return {
        success: true,
        message: FORGOT_PASSWORD_MESSAGE,
      };
    };

    // Honeypot: misma respuesta que éxito, sin enviar correo ni filtrar por email.
    if (dto.honeypot?.trim()) {
      return genericOk();
    }

    if (!this.captcha.validate(dto.challengeId, dto.challengeAnswer)) {
      return genericOk();
    }

    const email = dto.email?.trim() ?? '';
    if (!email) {
      return genericOk();
    }

    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.role === ('SUPER_ADMIN' as any)) {
      return genericOk();
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetExpires = new Date();
    resetExpires.setHours(resetExpires.getHours() + 1);

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        resetPasswordToken: resetToken,
        resetPasswordExpires: resetExpires,
      },
    });

    const frontendUrl =
      this.config.get('FRONTEND_URL') || 'http://localhost:4200';
    const resetLink = `${frontendUrl}/auth/reset-password?token=${resetToken}`;

    try {
      await this.emailService.sendMail({
        to: user.email,
        subject: 'Recuperación de Contraseña - Sistema TPM',
        html: `
        <div style="font-family: sans-serif; color: #333;">
          <h2>Recuperación de Contraseña</h2>
          <p>Hola <strong>${user.name}</strong>,</p>
          <p>Has solicitado restablecer tu contraseña. Haz clic en el siguiente enlace:</p>
          <p style="margin: 30px 0;">
            <a href="${resetLink}" style="padding: 12px 24px; background-color: #FF3366; color: white; text-decoration: none; border-radius: 8px; font-weight: bold;">Restablecer Contraseña</a>
          </p>
          <p>Este enlace expirará en 1 hora.</p>
          <p style="font-size: 0.8em; color: #666;">Si no fuiste tú, ignora este correo.</p>
        </div>
      `,
      });
    } catch (err) {
      this.log.warn(
        `No se pudo enviar email de recuperación para ${user.email}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      // Respuesta genérica para evitar enumeración de cuentas.
      await finishTiming();
      return {
        success: true,
        message: FORGOT_PASSWORD_MESSAGE,
      };
    }

    await finishTiming();
    return {
      success: true,
      message: FORGOT_PASSWORD_MESSAGE,
    };
  }

  async resetPassword(token: string, newPass: string, meta: LoginRequestMeta) {
    const user = await this.prisma.user.findFirst({
      where: {
        resetPasswordToken: token,
        resetPasswordExpires: { gt: new Date() },
      },
      include: { tenant: true, contractAccess: true },
    });

    if (!user) {
      throw new BadRequestException('Token inválido o expirado');
    }

    const hashedPassword = await bcrypt.hash(newPass, 10);
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        resetPasswordToken: null,
        resetPasswordExpires: null,
      },
    });

    await this.userSessions.invalidateAllForUser(user.id);

    const geo = await this.authAudit.lookupGeo(meta.clientIp);
    try {
      await this.authAudit.recordPasswordChange({
        userId: user.id,
        email: user.email,
        ip: (meta.clientIp || '').slice(0, 64),
        userAgent: (meta.userAgent || '').slice(0, 512),
        city: geo.city,
        country: geo.country,
      });
    } catch (e) {
      this.log.warn(`No se pudo registrar PASSWORD_CHANGE (reset): ${e}`);
    }

    return { success: true, message: 'Contraseña actualizada correctamente' };
  }
}
