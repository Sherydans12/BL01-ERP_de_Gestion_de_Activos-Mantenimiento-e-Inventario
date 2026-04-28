import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { PLATFORM_SECURITY_SETTINGS_ID } from './platform-security.constants';
import { userRoleCanEnrollTotp } from './totp-policy';

/**
 * Roles a los que hoy aplica el segundo factor por correo (IP/país no habituales).
 * Para añadir otro rol: incluirlo aquí y ampliar `AuthAuditService.shouldRequireEmailContextStepUp`.
 */
export const USER_ROLES_WITH_EMAIL_STEP_UP = ['SUPER_ADMIN'] as const;

@Injectable()
export class StepUpPolicyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * En local, desactiva por completo el flujo 2FA por correo (sin tocar la BD).
   * También usado en CI/demos. No usar en producción.
   * Ver `.env.example`: `AUTH_STEP_UP_BYPASS=true`
   */
  isLocalOrExplicitBypass(): boolean {
    return this.config.get<string>('AUTH_STEP_UP_BYPASS', '') === 'true';
  }

  async getPlatformStepUpEnabledFromDb(): Promise<boolean> {
    const row = await this.prisma.platformSecuritySettings.findUnique({
      where: { id: PLATFORM_SECURITY_SETTINGS_ID },
      select: { superAdminStepUpEmailEnabled: true },
    });
    return row?.superAdminStepUpEmailEnabled ?? false;
  }

  /**
   * Política de plataforma activa y no desactivada por env (p. ej. local).
   */
  async isGlobalStepUpPolicyEffective(): Promise<boolean> {
    if (this.isLocalOrExplicitBypass()) {
      return false;
    }
    return this.getPlatformStepUpEnabledFromDb();
  }

  userRoleUsesEmailStepUp(role: string): boolean {
    return (USER_ROLES_WITH_EMAIL_STEP_UP as readonly string[]).includes(role);
  }

  /**
   * Una sola lectura de BD + env; usar en listados (evita N+1).
   */
  async getListEvaluationContext(): Promise<{
    platformOn: boolean;
    bypass: boolean;
  }> {
    return {
      platformOn: await this.getPlatformStepUpEnabledFromDb(),
      bypass: this.isLocalOrExplicitBypass(),
    };
  }

  /**
   * Evalúa si el rol está sujeto a 2FA por correo dado el contexto ya resuelto.
   */
  appliesToUserRoleWithContext(
    role: string,
    platformOn: boolean,
    bypass: boolean,
  ): boolean {
    if (!this.userRoleUsesEmailStepUp(role)) return false;
    if (bypass) return false;
    return platformOn;
  }

  async getEmailStepUpAppliesToUserRole(role: string): Promise<boolean> {
    const ctx = await this.getListEvaluationContext();
    return this.appliesToUserRoleWithContext(role, ctx.platformOn, ctx.bypass);
  }

  /**
   * Snapshot para "Mi cuenta" y documentación de API.
   */
  async getSecuritySnapshotForUserRole(
    role: string,
    opts?: { totpEnabled?: boolean },
  ) {
    const [platformEmailStepUpEnabled, localDevBypass] = await Promise.all([
      this.getPlatformStepUpEnabledFromDb(),
      Promise.resolve(this.isLocalOrExplicitBypass()),
    ]);
    const subject = this.userRoleUsesEmailStepUp(role);
    const emailStepUpAppliesToThisUser = Boolean(
      subject && platformEmailStepUpEnabled && !localDevBypass,
    );
    return {
      platformEmailStepUpEnabled,
      localDevelopmentBypass: localDevBypass,
      emailStepUpAppliesToThisUser,
      totpEnrollable: userRoleCanEnrollTotp(role),
      totpEnabled: opts?.totpEnabled ?? false,
    };
  }
}
