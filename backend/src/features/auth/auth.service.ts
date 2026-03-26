import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { MailerService } from '@nestjs-modules/mailer';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private mailerService: MailerService,
    private config: ConfigService,
  ) {}

  async login(tenantCode: string, email: string, pass: string) {
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: {
        tenant: true,
        contractAccess: true, // Corregido: antes decía siteAccess
      },
    });

    if (!user) {
      throw new UnauthorizedException(
        'Credenciales inválidas o cuenta no activa',
      );
    }

    // 1. Validación de Tenant (Aislamiento)
    if (
      user.role !== ('SUPER_ADMIN' as any) &&
      tenantCode &&
      user.tenant?.code !== tenantCode.toUpperCase()
    ) {
      throw new UnauthorizedException(
        'Credenciales inválidas o cuenta no activa',
      );
    }

    // 2. Validación de Estado (Diferenciando flujo de invitación vs suspensión)
    if (!user.isActive) {
      throw new UnauthorizedException(
        'Credenciales inválidas o cuenta no activa',
      );
    }

    // 3. Validación de Password
    const isMatch = await bcrypt.compare(pass, user.password);
    if (!isMatch) {
      throw new UnauthorizedException(
        'Credenciales inválidas o cuenta no activa',
      );
    }

    // 4. Extracción de Contratos Permitidos
    let allowedContracts: string[] = [];
    if (user.role === 'ADMIN' || user.role === ('SUPER_ADMIN' as any)) {
      allowedContracts = ['ALL']; // Corregido: unificada la variable
    } else {
      allowedContracts = user.contractAccess.map((access) => access.contractId);
    }

    // 5. Generación de Payload y Token
    const payload = {
      email: user.email,
      sub: user.id,
      role: user.role,
      tenantId: user.tenantId,
      allowedContracts, // Corregido
    };

    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
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

  async activateAccount(token: string, newPassword: string) {
    const user = await this.prisma.user.findFirst({
      where: { activationToken: token },
      include: { tenant: true, contractAccess: true },
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

    const payload = {
      email: updatedUser.email,
      sub: updatedUser.id,
      role: updatedUser.role,
      tenantId: updatedUser.tenantId,
      allowedContracts, // Corregido
    };

    return {
      message: 'Cuenta activada exitosamente',
      access_token: this.jwtService.sign(payload),
      user: {
        id: updatedUser.id,
        email: updatedUser.email,
        name: updatedUser.name,
        role: updatedUser.role,
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

  async forgotPassword(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.role === ('SUPER_ADMIN' as any)) {
      // Seguridad: Devolvemos success true para no enumerar usuarios. SUPER_ADMIN descartado también
      return {
        success: true,
        message:
          'Si el correo existe en el sistema, recibirás un enlace de recuperación.',
      };
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

    await this.mailerService.sendMail({
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

    return {
      success: true,
      message:
        'Si el correo existe en el sistema, recibirás un enlace de recuperación.',
    };
  }

  async resetPassword(token: string, newPass: string) {
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

    return { success: true, message: 'Contraseña actualizada correctamente' };
  }
}
