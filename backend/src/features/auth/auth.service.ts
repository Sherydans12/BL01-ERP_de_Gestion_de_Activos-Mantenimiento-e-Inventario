import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  NotFoundException,
  Logger,
  HttpException,
  HttpStatus,
  ServiceUnavailableException,
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
import {
  buildMailForgotPassword,
  buildMailUnusualLogin,
} from '../../common/email/transactional-mail.builder';
import {
  normalizeEmail,
  prismaEmailInsensitive,
} from '../../common/email/email-normalize';
import { StorageService } from '../../common/storage/storage.service';
import { LoginStepUpService } from './login-step-up.service';
import { StepUpPolicyService } from './step-up-policy.service';
import { TotpService } from './totp.service';
import { parseTenantRolePermissions } from './permissions.util';
import { loadOperationalConfigForJwt } from './jwt-operational-config.util';

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
  /** Mensaje explícito cuando el código de empresa no coincide (cliente + logs). */
  private readonly loginTenantMismatchMessage =
    'El código de empresa no coincide con el de tu cuenta. Verifica el código e inténtalo de nuevo.';
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
    private readonly loginStepUp: LoginStepUpService,
    private readonly stepUpPolicy: StepUpPolicyService,
    private readonly totpService: TotpService,
  ) {}

  private async sendUnusualLoginSecurityEmail(params: {
    toEmail: string;
    name: string;
    deviceLabel: string;
    city: string;
    country: string;
    ip: string;
  }) {
    const locationLine = [params.city, params.country]
      .filter(Boolean)
      .join(', ');
    try {
      await this.emailService.sendMail({
        to: params.toEmail,
        subject: 'Alerta de seguridad — acceso inusual en TPM',
        html: buildMailUnusualLogin({
          name: params.name,
          deviceLabel: params.deviceLabel,
          ip: params.ip,
          locationLine,
        }),
      });
    } catch (e) {
      this.log.warn(
        `No se pudo enviar alerta SecurityEvent.UnusualLogin: ${e}`,
      );
    }
  }

  /** Permisos PBAC desde TenantRole; vacío si no hay rol custom o el JSON no es válido. */
  private resolveJwtPermissions(user: {
    customRoleId: string | null;
    customRole?: { permissions?: unknown } | null;
  }): string[] {
    if (!user.customRoleId || !user.customRole) {
      return [];
    }
    return parseTenantRolePermissions(user.customRole.permissions);
  }

  private async ensureMinFailureDelay(started: number): Promise<void> {
    const minMs = 320;
    const jitter = Math.floor(Math.random() * 150);
    const elapsed = Date.now() - started;
    const wait = minMs + jitter - elapsed;
    if (wait > 0) await sleep(wait);
  }

  /**
   * Depuración en logs del contenedor: ISO timestamp, email intentado, resultado y motivo.
   * No registrar contraseñas ni tokens.
   */
  private logLoginDiagnostic(payload: {
    outcome: 'failure' | 'success';
    reason: string;
    email: string;
    userId?: string | null;
    tenantCodeInput?: string;
    role?: string;
    ip?: string;
    detail?: string;
  }): void {
    const ts = new Date().toISOString();
    const segments: string[] = [
      '[LoginAttempt]',
      `ts=${ts}`,
      `outcome=${payload.outcome}`,
      `reason=${payload.reason}`,
      `email=${payload.email}`,
      payload.userId ? `userId=${payload.userId}` : 'userId=(none)',
    ];
    if (payload.tenantCodeInput !== undefined) {
      segments.push(`tenantCode=${payload.tenantCodeInput}`);
    }
    if (payload.role) segments.push(`role=${payload.role}`);
    if (payload.ip) segments.push(`ip=${payload.ip}`);
    if (payload.detail) segments.push(payload.detail);
    const line = segments.join(' ');
    if (payload.outcome === 'failure') {
      this.log.warn(line);
    } else {
      this.log.log(line);
    }
  }

  /** Incluye `tc` (código empresa del formulario) para resolver tenant en SUPER_ADMIN sin tenant en BD. */
  private signPreTotpLoginToken(
    userId: string,
    email: string,
    tenantCode?: string,
  ): string {
    const payload: Record<string, string> = {
      sub: userId,
      email,
      typ: 'pre_totp',
    };
    if (tenantCode?.trim()) {
      payload.tc = tenantCode.trim();
    }
    return this.jwtService.sign(payload, { expiresIn: '5m' });
  }

  /**
   * Contexto de UI tras login: empresa inferida por código en formulario (SUPER_ADMIN)
   * o por BD. El JWT **no** lleva tenant para SUPER_ADMIN (véase `completeLoginAfterPasswordOk`);
   * el backend usa `x-tenant-id` por request (JwtStrategy).
   */
  private async resolveEffectiveTenantForSession(
    user: {
      tenantId: string | null;
      role: string;
      tenant: {
        id: string;
        code: string;
        name: string;
        logoUrl: string | null;
      } | null;
    },
    loginTenantCode?: string | null,
  ): Promise<{
    jwtTenantId: string | null;
    tenantForResponse: {
      id: string;
      code: string;
      name: string;
      logoUrl: string | null;
    } | null;
  }> {
    if (user.tenantId && user.tenant) {
      return {
        jwtTenantId: user.tenantId,
        tenantForResponse: {
          id: user.tenant.id,
          code: user.tenant.code,
          name: user.tenant.name,
          logoUrl: user.tenant.logoUrl,
        },
      };
    }
    if (user.tenantId) {
      const t = await this.prisma.tenant.findUnique({
        where: { id: user.tenantId },
        select: { id: true, code: true, name: true, logoUrl: true },
      });
      return { jwtTenantId: user.tenantId, tenantForResponse: t };
    }
    const code = loginTenantCode?.trim();
    if (user.role === 'SUPER_ADMIN' && code) {
      const t = await this.prisma.tenant.findFirst({
        where: { code: code.toUpperCase() },
        select: { id: true, code: true, name: true, logoUrl: true },
      });
      if (t) {
        return {
          jwtTenantId: t.id,
          tenantForResponse: t,
        };
      }
    }
    return {
      jwtTenantId: user.tenantId,
      tenantForResponse: user.tenant
        ? {
            id: user.tenant.id,
            code: user.tenant.code,
            name: user.tenant.name,
            logoUrl: user.tenant.logoUrl,
          }
        : null,
    };
  }

  /**
   * 2FA por correo (contexto poco habitual), tras contraseña o TOTP.
   * Devuelve el payload de reto por correo o null si se sigue a sesión completa.
   */
  private async maybeSendEmailStepUp(
    user: {
      id: string;
      email: string;
      name: string;
      role: string;
      email2faEnabled: boolean;
    },
    ip: string,
    geo: { country: string },
    ua: string,
  ): Promise<{
    stepUpRequired: true;
    stepUpToken: string;
    message: string;
  } | null> {
    // Si el usuario lo activó explícitamente, SIEMPRE pide correo
    let requiresEmailStepUp = user.email2faEnabled;

    if (!requiresEmailStepUp) {
      // Regla antigua (contextual basada en IP, o forzada global)
      const roleApplies = this.stepUpPolicy.userRoleUsesEmailStepUp(user.role);
      if (roleApplies) {
        const globalEffective =
          await this.stepUpPolicy.isGlobalStepUpPolicyEffective();
        if (globalEffective) {
          const isContextUnusual =
            await this.authAudit.shouldRequireEmailContextStepUp({
              userId: user.id,
              role: user.role,
              ip,
              country: geo.country,
            });
          if (isContextUnusual) {
            requiresEmailStepUp = true;
          }
        }
      }
    }

    if (!requiresEmailStepUp) {
      return null;
    }
    try {
      const { stepUpToken } =
        await this.loginStepUp.createChallengeAndSendEmail({
          userId: user.id,
          userEmail: user.email,
          name: user.name,
          clientIp: ip,
          userAgent: ua,
        });
      return {
        stepUpRequired: true,
        stepUpToken,
        message:
          'Se envió un código de verificación a tu correo. Ingresa el código de 6 dígitos para continuar.',
      };
    } catch (e) {
      this.log.error(`Email step-up initiation failed: ${e}`);
      throw new ServiceUnavailableException(
        'No se pudo enviar el código de verificación. Intenta de nuevo en unos minutos.',
      );
    }
  }

  async login(dto: LoginDto, meta: LoginRequestMeta) {
    const started = Date.now();
    const geo = await this.authAudit.lookupGeo(meta.clientIp);
    const ip = (meta.clientIp || '').slice(0, 64);
    const ua = (meta.userAgent || '').slice(0, 512);

    const tenantCode = dto.tenantCode?.trim() ?? '';
    const email = normalizeEmail(dto.email ?? '');
    const pass = dto.password ?? '';

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

    const rejectLogin = async (
      reason: string,
      emailAttempted: string,
      userId: string | null,
      opts?: { clientMessage?: string },
    ): Promise<never> => {
      this.logLoginDiagnostic({
        outcome: 'failure',
        reason,
        email: emailAttempted,
        userId,
        tenantCodeInput: tenantCode || '(vacío)',
        ip,
      });
      await auditFail(emailAttempted, userId);
      await this.ensureMinFailureDelay(started);
      throw new UnauthorizedException(
        opts?.clientMessage ?? this.loginErrorMessage,
      );
    };

    if (dto.honeypot?.trim()) {
      await bcrypt.compare('x', BCRYPT_DUMMY_HASH);
      await rejectLogin('HONEYPOT_TRIGGERED', email || '(vacío)', null);
    }

    if (!this.captcha.validate(dto.challengeId, dto.challengeAnswer)) {
      await bcrypt.compare('x', BCRYPT_DUMMY_HASH);
      await rejectLogin('CAPTCHA_INVALID', email, null);
    }

    if (!email || !pass) {
      await bcrypt.compare('x', BCRYPT_DUMMY_HASH);
      await rejectLogin('MISSING_CREDENTIALS', email || '(vacío)', null);
    }

    const userRow = await this.prisma.user.findFirst({
      where: { email: prismaEmailInsensitive(email) },
      include: {
        tenant: true,
        contractAccess: true,
        customRole: true,
      },
    });

    if (!userRow) {
      await bcrypt.compare('x', BCRYPT_DUMMY_HASH);
      await rejectLogin('USER_NOT_FOUND', email, null);
    }

    const user = userRow!;

    if (user.lockoutUntil && user.lockoutUntil > new Date()) {
      this.logLoginDiagnostic({
        outcome: 'failure',
        reason: 'ACCOUNT_LOCKOUT_ACTIVE',
        email,
        userId: user.id,
        tenantCodeInput: tenantCode || '(vacío)',
        role: user.role,
        ip,
        detail: `lockoutUntil=${user.lockoutUntil.toISOString()}`,
      });
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
      this.logLoginDiagnostic({
        outcome: 'failure',
        reason: 'TENANT_CODE_MISMATCH',
        email,
        userId: user.id,
        tenantCodeInput: tenantCode || '(vacío)',
        role: user.role,
        ip,
        detail: `expectedTenantCode=${user.tenant?.code ?? '(sin tenant)'} supplied=${tenantCode.toUpperCase()}`,
      });
      await auditFail(email, user.id);
      await this.ensureMinFailureDelay(started);
      throw new UnauthorizedException(this.loginTenantMismatchMessage);
    }

    // 2. Validación de Estado (Diferenciando flujo de invitación vs suspensión)
    if (!user.isActive) {
      await bcrypt.compare('x', BCRYPT_DUMMY_HASH);
      await rejectLogin('ACCOUNT_INACTIVE', email, user.id);
    }

    // 3. Validación de Password
    const isMatch = await bcrypt.compare(pass, user.password);
    if (!isMatch) {
      await rejectLogin('INVALID_PASSWORD', email, user.id);
    }

    // Limpia bloqueo al autenticar credenciales correctamente (antes de 2FA o sesión)
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lockoutUntil: null },
    });

    // TOTP (cualquier cuenta con 2FA por app activo) — antes del 2FA por correo
    if (user.totpEnabled) {
      if (!user.totpSecretEncrypted) {
        this.log.error(
          `Usuario ${user.id} tiene totpEnabled sin secreto; no se puede continuar el login`,
        );
        throw new ServiceUnavailableException(
          'Configuración de autenticación en dos pasos inconsistente. Contacta al administrador.',
        );
      }
      this.logLoginDiagnostic({
        outcome: 'success',
        reason: 'PASSWORD_OK_PENDING_TOTP',
        email: user.email,
        userId: user.id,
        tenantCodeInput: tenantCode || '(vacío)',
        role: user.role,
        ip,
      });
      return {
        totpRequired: true,
        preAuthToken: this.signPreTotpLoginToken(
          user.id,
          user.email,
          tenantCode,
        ),
        message:
          'Ingresa el código de 6 dígitos de tu aplicación de autenticación (Google Authenticator o similar).',
      };
    }

    const emailStep = await this.maybeSendEmailStepUp(user, ip, geo, ua);
    if (emailStep) {
      this.logLoginDiagnostic({
        outcome: 'success',
        reason: 'PASSWORD_OK_PENDING_EMAIL_STEP_UP',
        email: user.email,
        userId: user.id,
        tenantCodeInput: tenantCode || '(vacío)',
        role: user.role,
        ip,
      });
      return emailStep;
    }

    return this.completeLoginAfterPasswordOk(user, {
      ip,
      ua,
      geo,
      loginTenantCode: tenantCode,
    });
  }

  private async completeLoginAfterPasswordOk(
    user: {
      id: string;
      email: string;
      name: string;
      firstName: string | null;
      lastName: string | null;
      phone: string | null;
      avatarUrl: string | null;
      role: string;
      customRoleId: string | null;
      tenantId: string | null;
      notifyUnusualLogin: boolean;
      canOverruleThreeWayMatch: boolean;
      contractAccess: { contractId: string }[];
      tenant: {
        id: string;
        name: string;
        code: string;
        logoUrl: string | null;
      } | null;
      customRole: { name: string; permissions?: unknown } | null;
    },
    ctx: {
      ip: string;
      ua: string;
      geo: { city: string; country: string };
      /** Código empresa del formulario (sesión SUPER_ADMIN sin tenant en BD). */
      loginTenantCode?: string;
    },
  ) {
    const { ip, ua, geo } = ctx;

    this.logLoginDiagnostic({
      outcome: 'success',
      reason: 'SESSION_JWT_ISSUED',
      email: user.email,
      userId: user.id,
      role: user.role,
      ip,
    });

    let allowedContracts: string[] = [];
    if (user.role === 'ADMIN' || user.role === 'SUPER_ADMIN') {
      allowedContracts = ['ALL'];
    } else {
      allowedContracts = user.contractAccess.map((access) => access.contractId);
    }

    try {
      const r = await this.authAudit.recordLoginSuccess({
        userId: user.id,
        email: user.email,
        ip,
        userAgent: ua,
        city: geo.city,
        country: geo.country,
      });
      if (r.isSuspicious && user.notifyUnusualLogin) {
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

    const { jwtTenantId, tenantForResponse } =
      await this.resolveEffectiveTenantForSession(user, ctx.loginTenantCode);

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

    /** SUPER_ADMIN: sin tenant en JWT; contexto operativo = cabecera `x-tenant-id` (cliente). */
    const tokenTenantId =
      user.role === 'SUPER_ADMIN' ? null : (jwtTenantId ?? user.tenantId);

    const permissions = this.resolveJwtPermissions(user);
    const operationalConfig = await loadOperationalConfigForJwt(
      this.prisma,
      tokenTenantId,
    );

    const payload = {
      email: user.email,
      sub: user.id,
      role: user.role,
      tenantId: tokenTenantId,
      allowedContracts,
      customRoleId: user.customRoleId ?? null,
      permissions,
      jti,
      ...(operationalConfig ? { operationalConfig } : {}),
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
        canOverruleThreeWayMatch: user.canOverruleThreeWayMatch,
        tenant: tenantForResponse
          ? {
              id: tenantForResponse.id,
              code: tenantForResponse.code,
              name: tenantForResponse.name,
              logoUrl: tenantForResponse.logoUrl,
              ...(operationalConfig ? { operationalConfig } : {}),
            }
          : null,
        allowedContracts,
      },
    };
  }

  /**
   * Tras contraseña correcta: verifica TOTP (6 dígitos) y continúa con
   * posible 2FA por correo o sesión JWT.
   */
  async verifyTotpLogin(
    body: { preAuthToken?: string; totpCode?: string },
    meta: LoginRequestMeta,
  ) {
    if (!body.preAuthToken?.trim() || !body.totpCode?.length) {
      throw new BadRequestException(
        'Código o sesión de verificación requeridos.',
      );
    }
    let userId: string;
    let loginTc: string | undefined;
    try {
      const p = this.jwtService.verify(body.preAuthToken);
      if (p.typ !== 'pre_totp') {
        throw new Error('typ');
      }
      userId = p.sub;
      loginTc = typeof p.tc === 'string' ? p.tc : undefined;
    } catch {
      throw new UnauthorizedException(
        'Sesión de verificación TOTP vencida o inválida.',
      );
    }
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { tenant: true, contractAccess: true, customRole: true },
    });
    if (!user?.isActive || !user.totpEnabled || !user.totpSecretEncrypted) {
      throw new UnauthorizedException('Cuenta no disponible o TOTP no activo.');
    }
    const secret = this.totpService.decryptSecret(user.totpSecretEncrypted);
    if (!this.totpService.verify(String(body.totpCode), secret)) {
      throw new UnauthorizedException('Código TOTP incorrecto.');
    }
    const geo = await this.authAudit.lookupGeo(meta.clientIp);
    const ip = (meta.clientIp || '').slice(0, 64);
    const ua = (meta.userAgent || '').slice(0, 512);
    const emailStep = await this.maybeSendEmailStepUp(user, ip, geo, ua);
    if (emailStep) {
      return emailStep;
    }
    return this.completeLoginAfterPasswordOk(user, {
      ip,
      ua,
      geo,
      loginTenantCode: loginTc,
    });
  }

  async verifySuperAdminStepUp(
    body: {
      stepUpToken?: string;
      code?: string;
      tenantCode?: string;
    },
    meta: LoginRequestMeta,
  ) {
    if (!body.stepUpToken?.trim() || !body.code?.length) {
      throw new BadRequestException(
        'Código o sesión de verificación requeridos.',
      );
    }
    const { userId } = await this.loginStepUp.verifyAndConsumeToken(
      body.stepUpToken,
      body.code,
    );
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        tenant: true,
        contractAccess: true,
        customRole: true,
      },
    });
    if (!user || !user.isActive) {
      throw new UnauthorizedException(
        'Cuenta no disponible o sesión de verificación inválida.',
      );
    }
    if (user.role !== 'SUPER_ADMIN') {
      throw new UnauthorizedException(
        'Sesión de verificación no válida para este usuario.',
      );
    }
    const geo = await this.authAudit.lookupGeo(meta.clientIp);
    const ip = (meta.clientIp || '').slice(0, 64);
    const ua = (meta.userAgent || '').slice(0, 512);
    return this.completeLoginAfterPasswordOk(user, {
      ip,
      ua,
      geo,
      loginTenantCode: body.tenantCode?.trim(),
    });
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

    const permissions = this.resolveJwtPermissions(user);
    const activationTenantId =
      updatedUser.role === ('SUPER_ADMIN' as any) ? null : updatedUser.tenantId;
    const operationalConfig = await loadOperationalConfigForJwt(
      this.prisma,
      activationTenantId,
    );

    const payload = {
      email: updatedUser.email,
      sub: updatedUser.id,
      role: updatedUser.role,
      tenantId: activationTenantId,
      allowedContracts,
      customRoleId: user.customRoleId ?? null,
      permissions,
      jti,
      ...(operationalConfig ? { operationalConfig } : {}),
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
        canOverruleThreeWayMatch: updatedUser.canOverruleThreeWayMatch,
        tenant: user.tenant
          ? {
              id: user.tenant.id,
              code: user.tenant.code,
              name: user.tenant.name,
              logoUrl: user.tenant.logoUrl,
              ...(operationalConfig ? { operationalConfig } : {}),
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

    const email = normalizeEmail(dto.email ?? '');
    if (!email) {
      return genericOk();
    }

    const user = await this.prisma.user.findFirst({
      where: { email: prismaEmailInsensitive(email) },
      include: { tenant: true },
    });
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
        subject: 'Recuperación de contraseña — Sistema TPM',
        html: buildMailForgotPassword({
          name: user.name,
          resetLink,
          organizationLine:
            user.tenant != null
              ? `${user.tenant.name} — código ${user.tenant.code}`
              : undefined,
        }),
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
